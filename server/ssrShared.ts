import fs from "fs";
import path from "path";
import { serializeJsonLd } from "../shared/json-ld";
import { PUBLIC_FOOTER_GROUPS } from "../shared/public-footer-links";
import { PUBLIC_NAV_CTA, PUBLIC_NAV_GROUPS, PUBLIC_NAV_UTILITY } from "../shared/public-navigation";
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
    @media (min-width: 1024px) { .ssr-nav-links { display: flex; align-items: center; gap: 1.75rem; font-size: 0.875rem; font-weight: 500; color: #334155; } }
    .ssr-nav-links a { display: inline-flex; align-items: center; min-height: 2.75rem; }
    .ssr-nav-links a:hover, .ssr-nav-support:hover { color: #071D57; }
    .ssr-nav-actions { display: flex; align-items: center; gap: 0.5rem; }
    @media (min-width: 640px) { .ssr-nav-actions { gap: 1rem; } }
    .ssr-nav-support { display: none; font-size: 0.875rem; font-weight: 500; color: #334155; align-items: center; min-height: 2.75rem; }
    @media (min-width: 1024px) { .ssr-nav-support { display: inline-flex; } }
    .ssr-cta-btn { display: none; align-items: center; gap: 0.5rem; background: #071D57; color: #fff; padding: 0.5rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; white-space: nowrap; min-height: 2.5rem; }
    @media (min-width: 640px) { .ssr-cta-btn { display: inline-flex; } }
    .ssr-cta-btn:hover { background: #0c2a7a; }
    .ssr-menu { display: block; }
    @media (min-width: 1024px) { .ssr-menu { display: none; } }
    .ssr-menu > summary { display: flex; align-items: center; justify-content: center; width: 3rem; height: 3rem; border-radius: 0.5rem; cursor: pointer; list-style: none; color: #071D57; font-size: 0.8125rem; font-weight: 600; }
    .ssr-menu > summary::-webkit-details-marker { display: none; }
    .ssr-menu[open] > summary { background: #f4f6fa; }
    .ssr-menu-panel { position: absolute; left: 0; right: 0; top: 100%; background: #fff; border-bottom: 1px solid #e2e8f0; box-shadow: 0 12px 24px -12px rgba(7,29,87,0.25); max-height: calc(100vh - 3.5rem); overflow-y: auto; padding: 0.5rem 1rem 1rem; }
    .ssr-menu-group { margin: 0.5rem 0 0; padding: 0.5rem 0.75rem 0; font-size: 0.8125rem; font-weight: 700; color: #071D57; text-transform: uppercase; letter-spacing: 0.06em; }
    .ssr-menu-panel ul { list-style: none; margin: 0; padding: 0; }
    .ssr-menu-panel li a { display: flex; align-items: center; min-height: 2.75rem; padding: 0.5rem 0.75rem; font-size: 0.9375rem; color: #334155; }
    .ssr-menu-panel li a:hover { color: #071D57; background: #f4f6fa; }
    .ssr-menu-panel .ssr-menu-offer a { border: 1px solid #e2e8f0; background: #f4f6fa; border-radius: 0.5rem; margin: 0.25rem 0.75rem 0; font-weight: 600; }
    .ssr-menu-panel .ssr-menu-cta { display: flex; justify-content: center; margin-top: 1rem; min-height: 3rem; font-size: 1rem; }

    /* Footer: brand + four link groups. Groups are <details open> (everything visible and crawlable without
       JavaScript); a tiny inline script after the footer collapses them below 1024px. */
    .ssr-footer { background: #071D57; border-top: 3px solid #C8102E; color: #fff; padding-top: 2.5rem; padding-bottom: 2rem; }
    .ssr-footer-grid { max-width: 1280px; margin: 0 auto; padding: 0 1rem; display: grid; grid-template-columns: 1fr; gap: 0; margin-bottom: 2rem; }
    @media (min-width: 640px) { .ssr-footer-grid { padding: 0 1.5rem; } }
    @media (min-width: 1024px) { .ssr-footer-grid { grid-template-columns: 1.1fr repeat(4, minmax(0, 1fr)); padding: 0 2rem; gap: 2.5rem; margin-bottom: 3rem; } .ssr-footer { padding-top: 4rem; } }
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
    @media (min-width: 1024px) {
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
  ${CLIENT_ASSET_TAGS}
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
        <a href="${escapeHtml(PUBLIC_NAV_UTILITY.href)}" class="ssr-nav-support">${escapeHtml(PUBLIC_NAV_UTILITY.label)}</a>
        <a href="${escapeHtml(PUBLIC_NAV_CTA.href)}" class="ssr-cta-btn">${escapeHtml(PUBLIC_NAV_CTA.label)}</a>
        <details class="ssr-menu">
          <summary aria-label="Open menu">Menu</summary>
          <div class="ssr-menu-panel">
${menuGroups}
            <p class="ssr-menu-group">${escapeHtml(PUBLIC_NAV_UTILITY.label)}</p>
            <ul><li><a href="${escapeHtml(PUBLIC_NAV_UTILITY.href)}">${escapeHtml(PUBLIC_NAV_UTILITY.label)}</a></li></ul>
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
  // Same four groups as the React footer (shared/public-footer-links.ts). Groups are <details open>, so every
  // link is visible and crawlable without JavaScript; the inline script below only collapses them below 1024px.
  const groups = PUBLIC_FOOTER_GROUPS.map((group) => `    <details class="ssr-footer-group" open>
      <summary>${escapeHtml(group.label)}</summary>
      <ul>
${group.links.map((link) => `        <li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`).join("\n")}
      </ul>
    </details>`).join("\n");
  return `<footer class="ssr-footer">
  <div class="ssr-footer-grid">
    <div class="ssr-footer-brand">
      <a href="/"><img src="${logoSrc}" alt="Liberty Bancard" class="ssr-footer-logo" width="193" height="40" /></a>
      <p class="ssr-footer-tagline">We don't sell a rate. We prove your real cost and fix it.</p>
      <h4>Contact</h4>
      <ul>
        <li><a href="tel:9542668214">📞 Call/Text 954-266-8214</a></li>
        <li><a href="mailto:support@libertybancard.com">✉ support@libertybancard.com</a></li>
        <li><a href="/get-started">📅 Book a review call</a></li>
      </ul>
    </div>
${groups}
  </div>
  <div class="ssr-footer-bottom">
    <div class="ssr-footer-trust">
      <div class="ssr-footer-trust-badge">✅ PCI DSS Compliant</div>
      <div class="ssr-footer-trust-badge">🏅 Registered ISO/MSP</div>
      <div class="ssr-footer-trust-badge">Visa | Mastercard | Discover | Amex</div>
    </div>
    <p class="ssr-footer-disclaimer">Liberty Bancard is a registered Independent Sales Organization (ISO) and merchant services provider. Liberty Bancard is not a bank. All merchant accounts are subject to application, credit approval, and underwriting by the acquiring bank and payment processor.</p>
    <p class="ssr-footer-disclaimer">${FOOTER_DISCLAIMER}</p>
    <p class="ssr-footer-disclaimer">${FOOTER_COMPLIANCE}</p>
    <p class="ssr-footer-copy">&copy; ${year} Liberty Bancard. All rights reserved. &nbsp;<a href="/do-not-sell" style="color:rgba(255,255,255,0.72);text-decoration:underline;">Do Not Sell or Share My Personal Information</a></p>
  </div>
</footer>
<script>(function(){var q=window.matchMedia("(min-width:1024px)");function f(){var g=document.querySelectorAll(".ssr-footer-group");for(var i=0;i<g.length;i++)g[i].open=q.matches;}f();if(q.addEventListener)q.addEventListener("change",f);})();</script>`;
}
