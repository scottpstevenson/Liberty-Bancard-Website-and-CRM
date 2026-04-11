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

export function registerSsrRoutes(app: Express) {
  app.get("/", (_req, res) => {
    const html = getHomeHtml();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.send(html);
  });

  app.get("/industries/:slug", (req, res) => {
    const html = getIndustryHtml(req.params.slug);
    if (!html) return res.status(404).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(html);
  });

  app.get("/compare/:competitor", (req, res) => {
    const html = getCompareHtml(req.params.competitor);
    if (!html) return res.status(404).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(html);
  });

  app.get("/locations/:city/:industry", (req, res) => {
    const html = getLocationHtml(req.params.city, req.params.industry);
    if (!html) return res.status(404).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=43200");
    res.send(html);
  });

  app.get("/locations/:city", (req, res) => {
    const html = getCityHubHtml(req.params.city);
    if (!html) return res.status(404).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(html);
  });

  app.get("/sitemap-locations.xml", (_req, res) => {
    const baseUrl = "https://libertybancard.com";
    const today = new Date().toISOString().split("T")[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const city of CITIES) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/locations/${city.slug}</loc>\n`;
      xml += `    <lastmod>${today}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      xml += `  </url>\n`;

      for (const vertical of VERTICALS) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/locations/${city.slug}/${vertical.slug}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
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
}
