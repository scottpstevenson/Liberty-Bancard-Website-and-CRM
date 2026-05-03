import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { SEO_ROUTE_DEFAULTS, type SeoRouteDefault } from "@shared/seo-routes";

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

// Legacy hardcoded PUBLIC_ROUTE_DEFAULTS map removed — the server now reads
// SEO_ROUTE_DEFAULTS from @shared/seo-routes so the dashboard, audit script,
// and SPA all stay in lockstep.

function evaluateRow(path: string, def: SeoRouteDefault): SeoCoverageRow {
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
  app.get("/api/admin/seo-coverage", requireRole("admin", "manager"), async (req, res) => {
    try {
      const rows: SeoCoverageRow[] = Object.entries(SEO_ROUTE_DEFAULTS).map(([path, def]) =>
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
