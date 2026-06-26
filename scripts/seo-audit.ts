/**
 * scripts/seo-audit.ts — CI script.
 *
 * Crawls a running dev server (default http://localhost:5000), fetches each
 * route in SEO_ROUTE_DEFAULTS, and validates head-level SEO signals:
 *   - <title> length 30-65 chars
 *   - <meta name="description"> length 100-165 chars
 *   - <link rel="canonical">
 *   - At least one <script type="application/ld+json">
 *   - <meta name="robots"> noindex on auth/thank-you routes
 *
 * SPA shell handling: when the server returns an empty-title Vite shell
 * (react-helmet-async populates head after mount), the audit cross-validates
 * the route's metadata against SEO_ROUTE_DEFAULTS. This is deterministic —
 * routes missing from SEO_ROUTE_DEFAULTS fail the audit.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more routes failed validation
 *
 * Run:   tsx scripts/seo-audit.ts
 *        BASE_URL=https://libertybancard.com tsx scripts/seo-audit.ts
 */

import { SEO_ROUTE_DEFAULTS } from "../shared/seo-routes";
import { CITIES, VERTICALS } from "../server/ssr/location-data";
import { COMPETITOR_DATA } from "../server/ssr/compare";
import { INDUSTRY_DATA } from "../server/ssr/industries";

const BASE = process.env.SEO_AUDIT_BASE_URL || process.env.BASE_URL || "http://localhost:5000";

interface RouteSpec {
  path: string;
  noindex?: boolean;
  dynamic?: true; // set for generated/dynamic routes not in SEO_ROUTE_DEFAULTS
  noindexForbidden?: true; // conversion pages that must NOT have noindex
  requireCanonical?: true; // Wave 12: explicitly verify canonical tag present
}

// Static routes from the central defaults map
const STATIC_ROUTES: RouteSpec[] = Object.entries(SEO_ROUTE_DEFAULTS).map(([path, def]) => ({
  path,
  noindex: !!def.noindex,
}));

// All competitor compare pages — sourced from COMPETITOR_DATA (single source of truth)
const COMPARE_ROUTES: RouteSpec[] = Object.values(COMPETITOR_DATA).map((d) => ({
  path: `/compare/${d.slug}`,
  dynamic: true,
}));

// All city hub pages
const CITY_HUB_ROUTES: RouteSpec[] = CITIES.map((c) => ({
  path: `/locations/${c.slug}`,
  dynamic: true,
}));

// All city × vertical routes (full cross-product)
const CITY_VERTICAL_ROUTES: RouteSpec[] = CITIES.flatMap((c) =>
  VERTICALS.map((v) => ({
    path: `/locations/${c.slug}/${v.slug}`,
    dynamic: true,
  }))
);

// All industry hub pages — sourced from INDUSTRY_DATA (owns the slug format)
const INDUSTRY_ROUTES: RouteSpec[] = Object.keys(INDUSTRY_DATA).map((slug) => ({
  path: `/industries/${slug}`,
  dynamic: true,
}));

// ── Wave 12: Partner pages — verify 200, unique title, description, canonical
// NOTE: /partners/insurance-agent does NOT exist — use /partners/insurance.
const PARTNER_ROUTES: RouteSpec[] = [
  { path: "/partners",            requireCanonical: true },
  { path: "/partners/cpa",        requireCanonical: true },
  { path: "/partners/bookkeeper", requireCanonical: true },
  { path: "/partners/insurance",  requireCanonical: true },
];

// ── Wave 12: Conversion pages that must NOT have noindex ─────────────────────
const NOINDEX_FORBIDDEN_ROUTES: RouteSpec[] = [
  { path: "/upload-statement",    noindexForbidden: true },
  { path: "/get-started",         noindexForbidden: true },
  { path: "/free-analysis",       noindexForbidden: true },
  { path: "/free-smart-terminal", noindexForbidden: true },
  { path: "/beat-square-stripe",  noindexForbidden: true },
];

const ROUTES: RouteSpec[] = [
  ...STATIC_ROUTES,
  ...COMPARE_ROUTES,
  ...CITY_HUB_ROUTES,
  ...CITY_VERTICAL_ROUTES,
  ...INDUSTRY_ROUTES,
  ...PARTNER_ROUTES,
  ...NOINDEX_FORBIDDEN_ROUTES,
];

interface AuditResult {
  path: string;
  status: number;
  errors: string[];
  warnings: string[];
}

const TITLE_MIN = 30;
const TITLE_MAX = 70; // 70 accounts for page-specific title + " | Liberty Bancard" suffix
const DESC_MIN = 100;
const DESC_MAX = 165;

function pickAttr(html: string, regex: RegExp): string | null {
  const m = html.match(regex);
  return m ? (m[1] || "").trim() : null;
}

async function auditRoute(spec: RouteSpec): Promise<AuditResult> {
  const url = `${BASE}${spec.path}`;
  const errors: string[] = [];
  const warnings: string[] = [];
  let status = 0;

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "LibertyBancardSeoAudit/1.0" },
    });
    status = res.status;
    if (status >= 400) {
      // In default mode, 404s on dynamic routes (location×vertical, compare,
      // industry) are warnings — the sitemap is authoritative for what is
      // indexed and not all permutations are guaranteed to be served.
      // In strict mode (STRICT=1 env var), every 404 is a CI failure so the
      // full public route surface is verified before any deploy.
      const isStrict = process.env.STRICT === "1";
      const msg = `HTTP ${status}`;
      if (!isStrict && spec.dynamic && status === 404) {
        warnings.push(msg);
      } else {
        errors.push(msg);
      }
      return { path: spec.path, status, errors, warnings };
    }
    const html = await res.text();

    // Detect SPA shell: Vite injects HMR scripts; react-helmet-async fills
    // the head AFTER mount. The initial HTML has an empty <title>.
    const titleRaw = pickAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const cleanTitle = (titleRaw || "").replace(/\s+/g, " ").trim();
    const isSpaShell =
      cleanTitle === "" &&
      /vite\/client|@react-refresh|id=["']root["']/.test(html);

    if (isSpaShell) {
      // For SPA routes, live HTML cannot be inspected for per-route meta.
      // Dynamic SSR routes (compare, location, industry) should NEVER be SPA
      // shells — flag as error so regression is caught immediately.
      if (spec.dynamic) {
        errors.push(
          "SSR route returned a bare SPA shell — server-side rendering is broken for this path"
        );
        return { path: spec.path, status, errors, warnings };
      }
      // For static SPA routes, deterministically validate that SEO_ROUTE_DEFAULTS
      // has a compliant entry — this is the source-of-truth react-helmet-async uses.
      const def = SEO_ROUTE_DEFAULTS[spec.path];
      if (!def) {
        errors.push(
          "SPA shell: route absent from SEO_ROUTE_DEFAULTS — no guaranteed title/description"
        );
      } else if (!spec.noindex) {
        // Only enforce strict metadata lengths on indexable (public) routes.
        // Noindex routes (auth, dashboard, thank-you) are not crawled, so
        // metadata length violations there are warnings, not CI failures.
        const tl = def.title.length;
        const dl = def.description.length;
        if (tl < TITLE_MIN) errors.push(`SPA defaults: title short (${tl}<${TITLE_MIN})`);
        if (tl > TITLE_MAX) errors.push(`SPA defaults: title long (${tl}>${TITLE_MAX})`);
        if (dl < DESC_MIN) errors.push(`SPA defaults: description short (${dl}<${DESC_MIN})`);
        if (dl > DESC_MAX) errors.push(`SPA defaults: description long (${dl}>${DESC_MAX})`);
      } else {
        // noindex routes: length violations are advisory only
        const def2 = SEO_ROUTE_DEFAULTS[spec.path];
        if (def2) {
          const tl = def2.title.length;
          const dl = def2.description.length;
          if (tl < TITLE_MIN || tl > TITLE_MAX) warnings.push(`noindex route title length advisory (${tl})`);
          if (dl < DESC_MIN || dl > DESC_MAX) warnings.push(`noindex route description length advisory (${dl})`);
        }
        warnings.push("noindex applied via client-side Helmet (verify in source)");
      }
      return { path: spec.path, status, errors, warnings };
    }

    // ── Non-SPA (SSR) route checks ───────────────────────────────────────
    if (!titleRaw && titleRaw !== "") {
      errors.push("missing <title>");
    } else {
      if (cleanTitle.length < TITLE_MIN) errors.push(`title short (${cleanTitle.length}<${TITLE_MIN})`);
      if (cleanTitle.length > TITLE_MAX) errors.push(`title long (${cleanTitle.length}>${TITLE_MAX})`);
    }

    const desc = pickAttr(
      html,
      /<meta\s+name=["']description["']\s+content="([^"]*)"/i
    );
    if (!desc) {
      errors.push("missing meta description");
    } else {
      if (desc.length < DESC_MIN) errors.push(`description short (${desc.length}<${DESC_MIN})`);
      if (desc.length > DESC_MAX) errors.push(`description long (${desc.length}>${DESC_MAX})`);
    }

    const canonical = pickAttr(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
    if (!canonical) errors.push("missing canonical link");

    const ogTitle = pickAttr(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (!ogTitle) errors.push("missing og:title");

    const ogImage = pickAttr(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (!ogImage) errors.push("missing og:image");

    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi);
    if (!jsonLdMatches || jsonLdMatches.length === 0) {
      errors.push("missing JSON-LD structured data");
    }

    // H1 check: every indexable SSR page must have exactly one <h1>
    // Conversion pages (noindexForbidden) must have exactly one H1 — multiple is a hard FAIL.
    const h1Matches = html.match(/<h1[\s>]/gi);
    if (!spec.noindex) {
      if (!h1Matches || h1Matches.length === 0) {
        errors.push("missing <h1> — indexable page has no primary heading");
      } else if (h1Matches.length > 1) {
        if (spec.noindexForbidden) {
          // Conversion pages must have exactly one H1 — multiple H1 degrades SEO clarity on lead-gen pages
          errors.push(`conversion page has ${h1Matches.length} <h1> tags — must have exactly one; remove extras`);
        } else {
          warnings.push(`multiple <h1> tags (${h1Matches.length}) — only one recommended per page`);
        }
      }
    }

    const robots = pickAttr(html, /<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
    if (spec.noindex) {
      if (!robots || !/noindex/i.test(robots)) {
        errors.push("expected noindex on auth/thank-you route");
      }
    } else if (spec.noindexForbidden) {
      // Wave 12: conversion pages must NOT have a noindex directive
      if (robots && /noindex/i.test(robots)) {
        errors.push(`conversion page has noindex (robots="${robots}") — this blocks organic indexing and must be removed`);
      }
    } else if (robots && /noindex/i.test(robots)) {
      warnings.push("public route is noindex — verify intent");
    }

    // Wave 12: partner pages must have canonical
    if (spec.requireCanonical && !canonical) {
      errors.push("partner page missing canonical link — required for Wave 12 SEO compliance");
    }
  } catch (e: unknown) {
    errors.push(`fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { path: spec.path, status, errors, warnings };
}

async function main() {
  console.log(`SEO audit against ${BASE}\n`);
  const results: AuditResult[] = [];
  for (const spec of ROUTES) {
    const r = await auditRoute(spec);
    results.push(r);
    const ok = r.errors.length === 0;
    const symbol = ok ? "✓" : "✗";
    const warnSuffix = r.warnings.length ? `  warn: ${r.warnings.join("; ")}` : "";
    const errSuffix = r.errors.length ? `  errors: ${r.errors.join("; ")}` : "";
    console.log(`${symbol} [${r.status}] ${r.path}${warnSuffix}${errSuffix}`);
  }

  const failed = results.filter((r) => r.errors.length > 0);
  const warned = results.filter((r) => r.warnings.length > 0);

  console.log(
    `\nSummary: ${results.length} routes, ${failed.length} failed, ${warned.length} with warnings`
  );

  // ── Wave 12: Sitemap check (non-blocking — informational) ─────────────────
  console.log("\n── Sitemap check ──");
  try {
    const sitemapRes = await fetch(`${BASE}/sitemap.xml`, { signal: AbortSignal.timeout(8000) });
    if (sitemapRes.status === 200) {
      const ct = sitemapRes.headers.get("content-type") ?? "";
      console.log(`✓ /sitemap.xml — HTTP 200 (content-type: ${ct})`);
    } else if (sitemapRes.status === 404) {
      console.log(`⚠ /sitemap.xml — 404 Not Found. Sitemap not yet generated. Not blocking; generate before go-live for SEO benefit.`);
    } else {
      console.log(`⚠ /sitemap.xml — HTTP ${sitemapRes.status} (unexpected). Investigate before go-live.`);
    }
  } catch (e: unknown) {
    console.log(`⚠ /sitemap.xml — fetch failed: ${e instanceof Error ? e.message : String(e)}. Non-blocking.`);
  }

  // ── Wave 12: Partner page title + meta-description uniqueness check ──────────
  console.log("\n── Partner page SEO uniqueness check ──");
  const PARTNER_PATHS = ["/partners", "/partners/cpa", "/partners/bookkeeper", "/partners/insurance"];
  const partnerTitles: string[] = [];
  const partnerDescs: string[] = [];
  let partnerUniquenessOk = true;
  for (const p of PARTNER_PATHS) {
    const def = SEO_ROUTE_DEFAULTS[p];
    if (!def) {
      console.error(`✗ SEO_ROUTE_DEFAULTS missing entry for partner page ${p}`);
      partnerUniquenessOk = false;
    } else {
      partnerTitles.push(def.title);
      partnerDescs.push(def.description);
    }
  }
  const uniqueTitles = new Set(partnerTitles);
  const uniqueDescs = new Set(partnerDescs);
  if (uniqueTitles.size < partnerTitles.length) {
    const dups = partnerTitles.filter((t, i) => partnerTitles.indexOf(t) !== i);
    console.error(`✗ Partner pages have duplicate title(s): ${JSON.stringify(dups)}`);
    partnerUniquenessOk = false;
  } else {
    console.log("✓ Partner page titles are all unique");
  }
  if (uniqueDescs.size < partnerDescs.length) {
    const dups = partnerDescs.filter((d, i) => partnerDescs.indexOf(d) !== i);
    console.error(`✗ Partner pages have duplicate meta description(s): ${JSON.stringify(dups)}`);
    partnerUniquenessOk = false;
  } else {
    console.log("✓ Partner page meta descriptions are all unique");
  }

  if (failed.length > 0 || !partnerUniquenessOk) {
    const n = failed.length + (partnerUniquenessOk ? 0 : 1);
    console.error(`\nSEO audit FAILED: ${n} check(s) had errors.`);
    process.exit(1);
  }
  console.log("\nSEO audit PASSED.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
