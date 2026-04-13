import type { Express } from "express";
import { getIndustryHtml } from "../ssr/industries";
import { getCompareHtml } from "../ssr/compare";
import { getLocationHtml, getCityHubHtml } from "../ssr/locations";
import { getHomeHtml } from "../ssr/home";
import {
  getUploadStatementHtml,
  getFreeAnalysisHtml,
  getWhyLibertyHtml,
  getZeroPercentHtml,
  getCaseStudiesHtml,
  getEquipmentHtml,
  getEstimateHtml,
  getSavingsCalculatorHtml,
  getCompareRatesHtml,
  getGetStartedHtml,
  getBeatSquareStripeHtml,
  getAffiliateProgramHtml,
  getFaqHtml,
} from "../ssr/pages";
import { CITIES, VERTICALS } from "../ssr/location-data";
import { storage } from "../storage";
import { renderBlogPostHtml, renderBlogHubHtml } from "../ssr/blog-ssr-data";
import { renderAlternativesHtml, renderSwitchFromHtml, getAvailableCompetitorSlugs } from "../ssr/competitor-ssr";
import { allBlogPostsServer } from "../ssr/all-blog-posts-server";
import type { BlogPost } from "../ssr/blog-ssr-data";

let dbPostsCache: BlogPost[] | null = null;
let dbCacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

async function getAllBlogPosts(): Promise<BlogPost[]> {
  const now = Date.now();
  if (dbPostsCache && now - dbCacheTime < CACHE_TTL_MS) {
    return [...allBlogPostsServer, ...dbPostsCache];
  }

  let dbPosts: BlogPost[] = [];
  try {
    const published = await storage.getGeneratedBlogPosts("published");
    const staticSlugs = new Set(allBlogPostsServer.map(p => p.slug));
    dbPosts = published
      .filter((p: any) => !staticSlugs.has(p.slug))
      .map((p: any): BlogPost => ({
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        category: p.category,
        author: p.author,
        readTime: p.readTime,
        publishDate: p.publishDate,
        publishedISO: p.publishedISO,
        modifiedISO: p.modifiedISO,
        keywords: p.keywords,
        metaDescription: p.metaDescription,
        content: p.content,
        faqs: p.faqs ?? undefined,
      }));
  } catch {
    dbPosts = [];
  }

  dbPostsCache = dbPosts;
  dbCacheTime = now;
  return [...allBlogPostsServer, ...dbPosts];
}

function notFoundHtml(title: string, message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title} | Liberty Bancard</title><style>body{font-family:sans-serif;text-align:center;padding:4rem 2rem;}a{color:#3b82f6;}</style></head><body><h1>${title}</h1><p>${message}</p><p><a href="/">Return Home</a></p></body></html>`;
}

const today = () => new Date().toISOString().split("T")[0];
const baseUrl = "https://libertybancard.com";

const COMPETITOR_SLUGS = [
  "square", "stripe", "clover", "toast", "paypal",
  "helcim", "authorize-net", "shopify-payments", "heartland",
  "worldpay", "fiserv", "gravity-payments",
];

const isDev = process.env.NODE_ENV !== "production";
const SSR_CACHE = isDev ? "no-store, no-cache" : "public, s-maxage=3600, stale-while-revalidate=86400";
const PAGE_CACHE = isDev ? "no-store, no-cache" : "public, max-age=86400";
const CITY_CACHE = isDev ? "no-store, no-cache" : "public, max-age=43200";

export function registerSsrRoutes(app: Express) {
  app.get("/", (_req, res) => {
    const html = getHomeHtml();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", SSR_CACHE);
    res.send(html);
  });

  app.get("/industries/:slug", (req, res) => {
    const html = getIndustryHtml(req.params.slug);
    if (!html) return res.status(404).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", PAGE_CACHE);
    res.send(html);
  });

  app.get("/compare/:competitor", (req, res) => {
    const html = getCompareHtml(req.params.competitor);
    if (!html) return res.status(404).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", PAGE_CACHE);
    res.send(html);
  });

  app.get("/locations/:city/:industry", (req, res) => {
    const html = getLocationHtml(req.params.city, req.params.industry);
    if (!html) return res.status(404).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", CITY_CACHE);
    res.send(html);
  });

  app.get("/locations/:city", (req, res) => {
    const html = getCityHubHtml(req.params.city);
    if (!html) return res.status(404).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", PAGE_CACHE);
    res.send(html);
  });

  app.get("/sitemap-locations.xml", (_req, res) => {
    const date = today();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const city of CITIES) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/locations/${city.slug}</loc>\n`;
      xml += `    <lastmod>${date}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      xml += `  </url>\n`;

      for (const vertical of VERTICALS) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/locations/${city.slug}/${vertical.slug}</loc>\n`;
        xml += `    <lastmod>${date}</lastmod>\n`;
        xml += `    <changefreq>monthly</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n`;
      }
    }

    xml += `</urlset>`;
    res.set("Content-Type", "application/xml");
    res.send(xml);
  });

  app.get("/upload-statement", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getUploadStatementHtml());
  });

  app.get("/free-analysis", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getFreeAnalysisHtml());
  });

  app.get("/why-liberty-bancard", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getWhyLibertyHtml());
  });

  app.get("/0-percent-processing", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getZeroPercentHtml());
  });

  app.get("/case-studies", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getCaseStudiesHtml());
  });

  app.get("/equipment", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getEquipmentHtml());
  });

  app.get("/estimate", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getEstimateHtml());
  });

  app.get("/savings-calculator", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getSavingsCalculatorHtml());
  });

  app.get("/compare-rates", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getCompareRatesHtml());
  });

  app.get("/get-started", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getGetStartedHtml());
  });

  app.get("/beat-square-stripe", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getBeatSquareStripeHtml());
  });

  app.get("/affiliate", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getAffiliateProgramHtml());
  });

  app.get("/faq", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(getFaqHtml());
  });

  app.get("/blog", async (_req, res) => {
    try {
      const posts = await getAllBlogPosts();
      const html = renderBlogHubHtml(posts);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err) {
      console.error("[SSR] Blog hub error:", err);
      res.redirect(302, "/?source=blog");
    }
  });

  app.get("/blog/:slug", async (req, res) => {
    const slug = req.params.slug;
    try {
      const posts = await getAllBlogPosts();
      const post = posts.find(p => p.slug === slug);

      if (!post) {
        res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(notFoundHtml("Blog Post Not Found", `The blog post "${slug}" does not exist.`));
        return;
      }

      const html = renderBlogPostHtml(post);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err) {
      console.error("[SSR] Blog post error:", err);
      res.redirect(302, "/blog");
    }
  });

  app.get("/alternatives/:competitor", (req, res) => {
    const competitor = req.params.competitor;
    const availableSlugs = getAvailableCompetitorSlugs();

    if (!availableSlugs.includes(competitor)) {
      res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(notFoundHtml("Alternatives Page Not Found", `We don't have an alternatives page for "${competitor}" yet.`));
      return;
    }

    const html = renderAlternativesHtml(competitor);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  app.get("/switch-from/:competitor", (req, res) => {
    const competitor = req.params.competitor;
    const availableSlugs = getAvailableCompetitorSlugs();

    if (!availableSlugs.includes(competitor)) {
      res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(notFoundHtml("Switch-From Page Not Found", `We don't have a switch-from guide for "${competitor}" yet.`));
      return;
    }

    const html = renderSwitchFromHtml(competitor);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  app.get("/sitemap-blog.xml", async (_req, res) => {
    const posts = await getAllBlogPosts();
    const date = today();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    xml += `  <url><loc>${baseUrl}/blog</loc><lastmod>${date}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    for (const post of posts) {
      const lastmod = post.modifiedISO ? post.modifiedISO.split("T")[0] : date;
      xml += `  <url><loc>${baseUrl}/blog/${post.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
    }
    xml += `</urlset>`;

    res.set("Content-Type", "application/xml");
    res.send(xml);
  });

  app.get("/sitemap-compare.xml", (_req, res) => {
    const date = today();
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    for (const slug of COMPETITOR_SLUGS) {
      xml += `  <url><loc>${baseUrl}/compare/${slug}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`;
      xml += `  <url><loc>${baseUrl}/alternatives/${slug}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
      xml += `  <url><loc>${baseUrl}/switch-from/${slug}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
    }
    xml += `</urlset>`;

    res.set("Content-Type", "application/xml");
    res.send(xml);
  });

  app.get("/sitemap-index.xml", (_req, res) => {
    const date = today();
    const sitemaps = [
      "/sitemap.xml",
      "/sitemap-blog.xml",
      "/sitemap-compare.xml",
      "/sitemap-locations.xml",
    ];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    for (const sm of sitemaps) {
      xml += `  <sitemap><loc>${baseUrl}${sm}</loc><lastmod>${date}</lastmod></sitemap>\n`;
    }
    xml += `</sitemapindex>`;

    res.set("Content-Type", "application/xml");
    res.send(xml);
  });
}
