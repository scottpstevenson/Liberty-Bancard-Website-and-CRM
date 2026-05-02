import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Content-addressed disk cache: SVG payload is deterministic from
// (template, slug, customTitle), so we hash those into the filename.
// First request renders + writes the SVG; subsequent requests stream
// from disk. Cache is safe to nuke at any time — it self-rebuilds.
const OG_CACHE_DIR = path.resolve(process.cwd(), "uploads", "og-cache");
try {
  fs.mkdirSync(OG_CACHE_DIR, { recursive: true });
} catch {
  // best-effort; fall back to in-memory render on cache failure
}

function ogCacheKey(template: string, slug: string, customTitle?: string): string {
  return crypto
    .createHash("sha1")
    .update(`${template}|${slug}|${customTitle || ""}`)
    .digest("hex")
    .slice(0, 32);
}

function readCachedSvg(key: string): string | null {
  try {
    const file = path.join(OG_CACHE_DIR, `${key}.svg`);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  } catch {
    // fall through to render
  }
  return null;
}

function writeCachedSvg(key: string, svg: string): void {
  try {
    const file = path.join(OG_CACHE_DIR, `${key}.svg`);
    fs.writeFileSync(file, svg, "utf8");
  } catch {
    // ignore — cache is best-effort
  }
}

const TEMPLATES = ["default", "article", "industry", "compare", "location", "service"] as const;
type Template = (typeof TEMPLATES)[number];

const TEMPLATE_GRADIENTS: Record<Template, [string, string]> = {
  default: ["#0f1f3d", "#1e3a8a"],
  article: ["#0f172a", "#0ea5e9"],
  industry: ["#1e3a5f", "#0284c7"],
  compare: ["#7c1d6f", "#be185d"],
  location: ["#064e3b", "#0d9488"],
  service: ["#1e3a5f", "#0ea5e9"],
};

const TEMPLATE_LABEL: Record<Template, string> = {
  default: "Liberty Bancard",
  article: "Insights",
  industry: "Industry",
  compare: "Comparison",
  location: "Location",
  service: "Service",
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

function wrapTitleSvgLines(title: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if ((current + " " + w).length <= maxCharsPerLine) {
      current += " " + w;
    } else {
      lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.length > lines.join(" ").split(/\s+/).length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+\S+$/, "") + "…";
  }
  return lines;
}

function renderOgSvg(template: Template, slug: string, customTitle?: string): string {
  const [fromColor, toColor] = TEMPLATE_GRADIENTS[template] || TEMPLATE_GRADIENTS.default;
  const label = TEMPLATE_LABEL[template] || "Liberty Bancard";
  const title = (customTitle || unslugify(slug) || "Liberty Bancard").slice(0, 120);
  const lines = wrapTitleSvgLines(title, 26, 3);
  const startY = 240 - (lines.length - 1) * 36;

  const titleTspans = lines
    .map(
      (line, i) =>
        `<tspan x="80" y="${startY + i * 88}">${escapeXml(line)}</tspan>`
    )
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
    <text x="80" y="100" font-size="22" font-weight="600" letter-spacing="6" opacity="0.65" text-transform="uppercase">${escapeXml(label.toUpperCase())}</text>
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

export function registerOgRoutes(app: Express) {
  app.get("/og/:template/:slug", (req, res) => {
    const rawTemplate = String(req.params.template || "default").toLowerCase();
    const template = (TEMPLATES.includes(rawTemplate as Template)
      ? rawTemplate
      : "default") as Template;

    const slugParam = String(req.params.slug || "").replace(/\.(svg|png)$/i, "");
    const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;

    const cacheKey = ogCacheKey(template, slugParam, customTitle);
    let svg = readCachedSvg(cacheKey);
    let cacheHit = !!svg;
    if (!svg) {
      svg = renderOgSvg(template, slugParam, customTitle);
      writeCachedSvg(cacheKey, svg);
    }

    // Browsers + most social crawlers (X, LinkedIn, Slack, Discord) accept SVG
    // og:image. We serve as image/svg+xml so requests to .png and .svg both work.
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
    res.setHeader("X-Og-Cache", cacheHit ? "HIT" : "MISS");
    res.setHeader("ETag", `"${cacheKey}"`);
    res.send(svg);
  });
}
