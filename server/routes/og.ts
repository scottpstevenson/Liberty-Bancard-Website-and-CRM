/**
 * server/routes/og.ts — Programmatic Open Graph image generation.
 *
 * Serves SVG-based social-preview cards for every page template.  Both the
 * /og/:template/:slug.svg and /og/:template/:slug.png endpoints return the
 * same SVG payload — SVG is a valid og:image format accepted by all major
 * crawlers (Facebook, Twitter/X, LinkedIn, Slack, Discord).
 *
 * Cache: disk-backed per (template, slug, customTitle); 24-hour CDN TTL.
 */

import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const OG_CACHE_DIR = path.resolve(process.cwd(), "uploads", "og-cache");
try {
  fs.mkdirSync(OG_CACHE_DIR, { recursive: true });
} catch {
  // best-effort — if the dir can't be created we just skip caching
}

function cacheKey(template: string, slug: string, customTitle?: string): string {
  return crypto
    .createHash("sha1")
    .update(`${template}|${slug}|${customTitle || ""}`)
    .digest("hex")
    .slice(0, 32);
}

function readCached(key: string): Buffer | null {
  try {
    const file = path.join(OG_CACHE_DIR, `${key}.svg`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
  } catch {
    /* ignore */
  }
  return null;
}

function writeCached(key: string, data: Buffer): void {
  try {
    fs.writeFileSync(path.join(OG_CACHE_DIR, `${key}.svg`), data);
  } catch {
    /* ignore — cache is best-effort */
  }
}

const TEMPLATES = ["default", "article", "industry", "compare", "location", "service"] as const;
type Template = (typeof TEMPLATES)[number];

const TEMPLATE_GRADIENTS: Record<Template, [string, string]> = {
  default:  ["#0f1f3d", "#1e3a8a"],
  article:  ["#0f172a", "#0ea5e9"],
  industry: ["#1e3a5f", "#0284c7"],
  compare:  ["#7c1d6f", "#be185d"],
  location: ["#064e3b", "#0d9488"],
  service:  ["#1e3a5f", "#0ea5e9"],
};

const TEMPLATE_LABEL: Record<Template, string> = {
  default:  "Liberty Bancard",
  article:  "Insights",
  industry: "Industry",
  compare:  "Comparison",
  location: "Location",
  service:  "Service",
};

function escapeXml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unslugify(slug: string): string {
  return slug
    .replace(/\.(svg|png)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function wrapLines(title: string, maxChars: number, maxLines: number): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if ((current + " " + w).length <= maxChars) {
      current += " " + w;
    } else {
      lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (
    lines.length === maxLines &&
    words.length > lines.join(" ").split(/\s+/).length
  ) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+\S+$/, "") + "…";
  }
  return lines;
}

function renderSvg(template: Template, slug: string, customTitle?: string): string {
  const [fromColor, toColor] = TEMPLATE_GRADIENTS[template];
  const label = TEMPLATE_LABEL[template];
  const title = (customTitle || unslugify(slug) || "Liberty Bancard").slice(0, 120);
  const lines = wrapLines(title, 26, 3);
  const startY = 240 - (lines.length - 1) * 36;
  const titleTspans = lines
    .map((line, i) => `<tspan x="80" y="${startY + i * 88}">${escapeXml(line)}</tspan>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${fromColor}"/>
      <stop offset="100%" stop-color="${toColor}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.15" r="0.6">
      <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="6" fill="#0ea5e9"/>
  <g font-family="Outfit, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" fill="#ffffff">
    <text x="80" y="100" font-size="22" font-weight="600" letter-spacing="6" opacity="0.65">${escapeXml(label.toUpperCase())}</text>
    <text font-size="74" font-weight="800" letter-spacing="-1.5">${titleTspans}</text>
    <text x="80" y="540" font-size="22" font-weight="500" opacity="0.85">libertybancard.com</text>
    <text x="80" y="572" font-size="18" font-weight="400" opacity="0.6">Transparent payment processing • Statement-based pricing</text>
  </g>
  <g transform="translate(960,460)" font-family="Outfit, system-ui, sans-serif" fill="#ffffff">
    <rect x="0" y="0" width="160" height="48" rx="24" fill="rgba(14,165,233,0.95)"/>
    <text x="80" y="31" font-size="18" font-weight="700" text-anchor="middle">LIBERTY</text>
  </g>
</svg>`;
}

function resolveTemplate(raw: string): Template {
  const t = raw.toLowerCase();
  return (TEMPLATES.includes(t as Template) ? t : "default") as Template;
}

function serveSvg(
  template: Template,
  slugParam: string,
  customTitle: string | undefined,
  res: import("express").Response
): void {
  const key = cacheKey(template, slugParam, customTitle);
  let buf = readCached(key);
  const hit = !!buf;
  if (!buf) {
    buf = Buffer.from(renderSvg(template, slugParam, customTitle), "utf8");
    writeCached(key, buf);
  }
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
  res.setHeader("X-Og-Cache", hit ? "HIT" : "MISS");
  res.setHeader("ETag", `"${key}"`);
  res.send(buf);
}

export function registerOgRoutes(app: Express) {
  // SVG endpoint
  app.get("/og/:template/:slug.svg", (req, res) => {
    const template = resolveTemplate(String(req.params.template || "default"));
    const slug = String(req.params.slug || "");
    const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;
    serveSvg(template, slug, customTitle, res);
  });

  // PNG endpoint — serves SVG payload; accepted by all major social crawlers
  app.get("/og/:template/:slug.png", (req, res) => {
    const template = resolveTemplate(String(req.params.template || "default"));
    const slug = String(req.params.slug || "");
    const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;
    serveSvg(template, slug, customTitle, res);
  });

  // Legacy bare route (no extension) — SVG for backward compatibility
  app.get("/og/:template/:slug", (req, res) => {
    const template = resolveTemplate(String(req.params.template || "default"));
    const slug = String(req.params.slug || "").replace(/\.(svg|png)$/i, "");
    const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;
    serveSvg(template, slug, customTitle, res);
  });
}
