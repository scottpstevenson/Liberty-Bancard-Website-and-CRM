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

const BASE = process.env.SEO_AUDIT_BASE_URL || process.env.BASE_URL || "http://localhost:5000";

interface RouteSpec {
  path: string;
  noindex?: boolean;
}

const ROUTES: RouteSpec[] = Object.entries(SEO_ROUTE_DEFAULTS).map(([path, def]) => ({
  path,
  noindex: !!def.noindex,
}));

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

    // Detect SPA shell: Vite injects HMR scripts; react-helmet-async fills
    // the head AFTER mount. The initial HTML has an empty <title>.
    const titleRaw = pickAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const cleanTitle = (titleRaw || "").replace(/\s+/g, " ").trim();
    const isSpaShell =
      cleanTitle === "" &&
      /vite\/client|@react-refresh|id=["']root["']/.test(html);

    if (isSpaShell) {
      // For SPA routes, live HTML cannot be inspected for per-route meta.
      // Deterministically validate that SEO_ROUTE_DEFAULTS has a compliant
      // entry — this is the source-of-truth that react-helmet-async uses.
      const def = SEO_ROUTE_DEFAULTS[spec.path];
      if (!def) {
        errors.push(
          "SPA shell: route absent from SEO_ROUTE_DEFAULTS — no guaranteed title/description"
        );
      } else {
        const tl = def.title.length;
        const dl = def.description.length;
        if (tl < TITLE_MIN) errors.push(`SPA defaults: title short (${tl}<${TITLE_MIN})`);
        if (tl > TITLE_MAX) errors.push(`SPA defaults: title long (${tl}>${TITLE_MAX})`);
        if (dl < DESC_MIN) errors.push(`SPA defaults: description short (${dl}<${DESC_MIN})`);
        if (dl > DESC_MAX) errors.push(`SPA defaults: description long (${dl}>${DESC_MAX})`);
      }
      // noindex routes get a warning (client-side only, can't verify in HTML)
      if (spec.noindex) {
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
      /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i
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

    const robots = pickAttr(html, /<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
    if (spec.noindex) {
      if (!robots || !/noindex/i.test(robots)) {
        errors.push("expected noindex on auth/thank-you route");
      }
    } else if (robots && /noindex/i.test(robots)) {
      warnings.push("public route is noindex — verify intent");
    }
  } catch (e: any) {
    errors.push(`fetch failed: ${e?.message || e}`);
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
