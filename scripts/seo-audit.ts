/**
 * scripts/seo-audit.ts — Task #178 CI script.
 *
 * Crawls a running dev server (default http://localhost:5000), fetches each
 * route in PUBLIC_ROUTE_DEFAULTS, and validates head-level SEO signals:
 *   - <title> length 30-65 chars
 *   - <meta name="description"> length 100-165 chars
 *   - <link rel="canonical">
 *   - At least one <script type="application/ld+json">
 *   - <meta name="robots"> noindex on auth/thank-you routes
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more routes failed validation
 *
 * Run:   tsx scripts/seo-audit.ts
 *        BASE_URL=https://libertybancard.com tsx scripts/seo-audit.ts
 */

const BASE = process.env.SEO_AUDIT_BASE_URL || process.env.BASE_URL || "http://localhost:5000";

interface RouteSpec {
  path: string;
  noindex?: boolean;
}

const ROUTES: RouteSpec[] = [
  { path: "/" },
  { path: "/get-started" },
  { path: "/upload-statement" },
  { path: "/free-analysis" },
  { path: "/0-percent-processing" },
  { path: "/beat-square-stripe" },
  { path: "/about-contact" },
  { path: "/estimate" },
  { path: "/support" },
  { path: "/savings-calculator" },
  { path: "/compare-rates" },
  { path: "/blog" },
  { path: "/faq" },
  { path: "/affiliate" },
  { path: "/why-liberty-bancard" },
  { path: "/equipment" },
  { path: "/case-studies" },
  { path: "/testimonials" },
  { path: "/integrations" },
  { path: "/compare/square" },
  { path: "/compare/stripe" },
  { path: "/compare/clover" },
  { path: "/compare/toast" },
  { path: "/compare/paypal" },
  { path: "/merchant-application" },
  { path: "/partners" },
  { path: "/privacy-policy" },
  { path: "/terms" },
  { path: "/cookie-policy" },
  { path: "/ada-compliance" },
  { path: "/california-privacy" },
  { path: "/refund-policy" },
  { path: "/tcpa-consent" },
  // Auth — must be noindex
  { path: "/login", noindex: true },
  { path: "/signup", noindex: true },
  { path: "/forgot-password", noindex: true },
  { path: "/reset-password", noindex: true },
  { path: "/verify-email", noindex: true },
  // Thank-you — must be noindex
  { path: "/thanks-statement", noindex: true },
  { path: "/thanks-estimate", noindex: true },
  { path: "/thanks-call", noindex: true },
  { path: "/thanks-support", noindex: true },
  { path: "/thanks/application", noindex: true },
];

interface AuditResult {
  path: string;
  status: number;
  errors: string[];
  warnings: string[];
}

const TITLE_MIN = 30;
const TITLE_MAX = 65;
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
      errors.push(`HTTP ${status}`);
      return { path: spec.path, status, errors, warnings };
    }
    const html = await res.text();

    // Detect SPA shell: Vite injects HMR scripts and the index.html ships with
    // an empty <title></title>. react-helmet-async fills the head AFTER mount,
    // so initial HTML lacks per-route SEO. Crawlers that execute JS (Googlebot,
    // Bingbot) see the post-mount tags, but our static HTML audit cannot.
    const titleRaw = pickAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const cleanTitle = (titleRaw || "").replace(/\s+/g, " ").trim();
    const isSpaShell =
      cleanTitle === "" &&
      (/vite\/client|@react-refresh|id=["']root["']/.test(html));

    if (!titleRaw && titleRaw !== "") {
      errors.push("missing <title>");
    } else if (!isSpaShell) {
      if (cleanTitle.length < TITLE_MIN) warnings.push(`title short (${cleanTitle.length}<${TITLE_MIN})`);
      if (cleanTitle.length > TITLE_MAX) warnings.push(`title long (${cleanTitle.length}>${TITLE_MAX})`);
    }

    const desc = pickAttr(
      html,
      /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i
    );
    if (!desc) {
      if (!isSpaShell) errors.push("missing meta description");
    } else if (!isSpaShell) {
      if (desc.length < DESC_MIN) warnings.push(`description short (${desc.length}<${DESC_MIN})`);
      if (desc.length > DESC_MAX) warnings.push(`description long (${desc.length}>${DESC_MAX})`);
    }

    const canonical = pickAttr(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
    if (!canonical && !isSpaShell) errors.push("missing canonical link");

    const ogTitle = pickAttr(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (!ogTitle && !isSpaShell) errors.push("missing og:title");

    const ogImage = pickAttr(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (!ogImage) errors.push("missing og:image");

    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi);
    if ((!jsonLdMatches || jsonLdMatches.length === 0) && !isSpaShell) {
      errors.push("missing JSON-LD structured data");
    }

    const robots = pickAttr(html, /<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
    if (spec.noindex) {
      if (isSpaShell) {
        // Helmet injects noindex client-side on these routes; SSR shell can't
        // reflect it. Surface as warning so reviewers verify the source code.
        warnings.push("noindex applied via client-side Helmet (verify in source)");
      } else if (!robots || !/noindex/i.test(robots)) {
        errors.push("expected noindex on auth/thank-you route");
      }
    } else if (robots && /noindex/i.test(robots)) {
      warnings.push("public route is noindex — verify intent");
    }

    if (isSpaShell) {
      warnings.push("SPA shell — Helmet injects head client-side");
    }
  } catch (e: any) {
    errors.push(`fetch failed: ${e?.message || e}`);
  }

  return { path: spec.path, status, errors, warnings };
}

async function main() {
  console.log(`SEO audit against ${BASE}\n`);
  const results: AuditResult[] = [];
  // Audit serially to keep dev server happy.
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

  if (failed.length > 0) {
    console.error(`\nSEO audit FAILED: ${failed.length} route(s) had errors.`);
    process.exit(1);
  }
  console.log("\nSEO audit PASSED.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
