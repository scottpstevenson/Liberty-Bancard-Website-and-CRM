import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as zlib from "zlib";

const OG_CACHE_DIR = path.resolve(process.cwd(), "uploads", "og-cache");
try {
  fs.mkdirSync(OG_CACHE_DIR, { recursive: true });
} catch {
  // best-effort
}

function ogCacheKey(template: string, slug: string, customTitle?: string): string {
  return crypto
    .createHash("sha1")
    .update(`${template}|${slug}|${customTitle || ""}`)
    .digest("hex")
    .slice(0, 32);
}

function readCached(key: string, ext: "svg" | "png"): Buffer | null {
  try {
    const file = path.join(OG_CACHE_DIR, `${key}.${ext}`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
  } catch {
    // fall through
  }
  return null;
}

function writeCached(key: string, ext: "svg" | "png", data: Buffer): void {
  try {
    fs.writeFileSync(path.join(OG_CACHE_DIR, `${key}.${ext}`), data);
  } catch {
    // ignore — cache is best-effort
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

// ── Pure-Node PNG generation ─────────────────────────────────────────────────
// Generates a proper image/png OG image (1200×630) as a diagonal gradient.
// Uses only Node built-ins (zlib for DEFLATE, Buffer for binary assembly).

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function renderOgPng(template: Template): Buffer {
  const W = 1200;
  const H = 630;
  const [fromHex, toHex] = TEMPLATE_GRADIENTS[template] || TEMPLATE_GRADIENTS.default;
  const [r1, g1, b1] = hexToRgb(fromHex);
  const [r2, g2, b2] = hexToRgb(toHex);

  // Build raw filter+pixel rows (diagonal gradient: t = (x/W + y/H) / 2)
  const rawRows: Buffer[] = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    row[0] = 0; // filter: None
    for (let x = 0; x < W; x++) {
      const t = (x / (W - 1) + y / (H - 1)) / 2;
      row[1 + x * 3]     = lerp(r1, r2, t);
      row[1 + x * 3 + 1] = lerp(g1, g2, t);
      row[1 + x * 3 + 2] = lerp(b1, b2, t);
    }
    rawRows.push(row);
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData, { level: 6 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerOgRoutes(app: Express) {
  // SVG endpoint — rich text layout, accepted by most social crawlers
  app.get("/og/:template/:slug.svg", (req, res) => {
    const rawTemplate = String(req.params.template || "default").toLowerCase();
    const template = (TEMPLATES.includes(rawTemplate as Template) ? rawTemplate : "default") as Template;
    const slugParam = String(req.params.slug || "");
    const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;

    const cacheKey = ogCacheKey(template, slugParam, customTitle);
    let svgBuf = readCached(cacheKey, "svg");
    const cacheHit = !!svgBuf;
    if (!svgBuf) {
      const svg = renderOgSvg(template, slugParam, customTitle);
      svgBuf = Buffer.from(svg, "utf8");
      writeCached(cacheKey, "svg", svgBuf);
    }

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
    res.setHeader("X-Og-Cache", cacheHit ? "HIT" : "MISS");
    res.setHeader("ETag", `"${cacheKey}-svg"`);
    res.send(svgBuf);
  });

  // PNG endpoint — proper image/png for Twitter/X and any platform that
  // requires a raster format. Generated via pure-Node zlib (no sharp needed).
  app.get("/og/:template/:slug.png", (req, res) => {
    const rawTemplate = String(req.params.template || "default").toLowerCase();
    const template = (TEMPLATES.includes(rawTemplate as Template) ? rawTemplate : "default") as Template;
    const slugParam = String(req.params.slug || "");
    const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;

    const cacheKey = ogCacheKey(template, slugParam, customTitle);
    let pngBuf = readCached(cacheKey, "png");
    const cacheHit = !!pngBuf;
    if (!pngBuf) {
      pngBuf = renderOgPng(template);
      writeCached(cacheKey, "png", pngBuf);
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
    res.setHeader("X-Og-Cache", cacheHit ? "HIT" : "MISS");
    res.setHeader("ETag", `"${cacheKey}-png"`);
    res.send(pngBuf);
  });

  // Legacy bare route (no extension) — serves SVG for backward compatibility
  app.get("/og/:template/:slug", (req, res) => {
    const rawTemplate = String(req.params.template || "default").toLowerCase();
    const template = (TEMPLATES.includes(rawTemplate as Template) ? rawTemplate : "default") as Template;
    const slugParam = String(req.params.slug || "").replace(/\.(svg|png)$/i, "");
    const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;

    const cacheKey = ogCacheKey(template, slugParam, customTitle);
    let svgBuf = readCached(cacheKey, "svg");
    const cacheHit = !!svgBuf;
    if (!svgBuf) {
      const svg = renderOgSvg(template, slugParam, customTitle);
      svgBuf = Buffer.from(svg, "utf8");
      writeCached(cacheKey, "svg", svgBuf);
    }

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
    res.setHeader("X-Og-Cache", cacheHit ? "HIT" : "MISS");
    res.setHeader("ETag", `"${cacheKey}-svg"`);
    res.send(svgBuf);
  });
}
