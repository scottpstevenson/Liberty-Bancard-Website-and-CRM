/**
 * server/routes/og.ts — Programmatic Open Graph image generation.
 *
 * Route contract:
 *   GET /og/:template/:slug.svg  → SVG  (image/svg+xml)
 *   GET /og/:template/:slug.png  → PNG  (image/png) via sharp rasterization
 *   GET /og/:template/:slug      → SVG  (backward-compat legacy route)
 *
 * Cache: disk-backed per (template, slug, customTitle); 24-hour CDN TTL.
 * Cache dir: uploads/og-cache/ (gitignored, runtime artifact).
 */

import type { Express, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import sharp from "sharp";

let ogCacheDir = path.resolve(process.cwd(), "uploads", "og-cache");

function cacheKey(template: string, slug: string, customTitle?: string): string {
  return crypto
    .createHash("sha256")
    // Structured input prevents delimiter ambiguity between slug and title.
    .update(JSON.stringify([template, slug, customTitle || ""]))
    .digest("hex")
    ;
}

const CACHE_KEY_RE = /^[a-f0-9]{64}$/;
const CACHE_EXTENSIONS = new Set(["svg", "png"]);

function assertTrustedCacheRoot(root: string): string {
  let ownerUid: number | undefined;
  if (process.platform !== "win32") {
    const getuid = process.getuid;
    if (typeof getuid !== "function") {
      throw new Error("Unable to validate OG cache root owner");
    }
    ownerUid = getuid();
  }

  let entry: fs.Stats;
  try {
    // lstat is intentionally used before mkdir/open: an existing cache-root
    // symlink is never a valid root, even if its target is otherwise safe.
    entry = fs.lstatSync(root);
  } catch (error: unknown) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    entry = fs.lstatSync(root);
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("Invalid OG cache root");
  }

  if (ownerUid !== undefined) {
    if (entry.uid !== ownerUid || (entry.mode & 0o077) !== 0) {
      throw new Error("Untrusted OG cache root");
    }
  }

  // Re-open the path with O_NOFOLLOW so a replacement between lstat and use
  // cannot make this process trust a symlink. O_DIRECTORY also rejects files.
  const fd = fs.openSync(
    root,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isDirectory() || (ownerUid !== undefined && (
      opened.uid !== ownerUid || (opened.mode & 0o077) !== 0
    ))) {
      throw new Error("Untrusted OG cache root");
    }
  } finally {
    fs.closeSync(fd);
  }
  return root;
}

/**
 * This is the sole filesystem path construction point for cache artifacts.
 * Cache keys are hashes produced above, but validate again here so a future
 * caller cannot turn this cache into an arbitrary file read/write primitive.
 */
function cacheFilePath(key: string, ext: string): string {
  if (!CACHE_KEY_RE.test(key) || !CACHE_EXTENSIONS.has(ext)) {
    throw new Error("Invalid OG cache artifact");
  }
  const root = assertTrustedCacheRoot(ogCacheDir);
  const file = path.resolve(root, `${key}.${ext}`);
  if (path.dirname(file) !== root) {
    throw new Error("Invalid OG cache artifact");
  }
  return file;
}

function readCached(key: string, ext: "svg" | "png"): Buffer | null {
  let fd: number | undefined;
  try {
    // O_NOFOLLOW and fstat on the opened descriptor prevent symlink reads and
    // ensure that only regular cache files are ever served.
    fd = fs.openSync(
      cacheFilePath(key, ext),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) return null;
    return fs.readFileSync(fd);
  } catch {
    /* ignore */
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function writeCached(key: string, ext: "svg" | "png", data: Buffer): boolean {
  let fd: number | undefined;
  let tempFile: string | undefined;
  let committed = false;
  try {
    const destination = cacheFilePath(key, ext);
    // A random, exclusive, owner-only temp file avoids partial cache entries.
    // Atomic link publication below never replaces an existing artifact.
    tempFile = path.resolve(
      ogCacheDir,
      `.${key}.${crypto.randomBytes(16).toString("hex")}.tmp`,
    );
    if (path.dirname(tempFile) !== ogCacheDir) throw new Error("Invalid OG cache artifact");
    fd = fs.openSync(
      tempFile,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    const tempStat = fs.fstatSync(fd);
    if (!tempStat.isFile() || tempStat.nlink !== 1) {
      throw new Error("Invalid OG cache temp file");
    }
    fs.closeSync(fd);
    fd = undefined;
    // link(2) atomically publishes only when the final name is absent. Unlike
    // rename, it can never replace a hostile existing symlink/device/hardlink
    // or a concurrently published cache entry.
    fs.linkSync(tempFile, destination);
    fs.unlinkSync(tempFile);
    committed = true;
    return true;
  } catch {
    /* ignore — cache is best-effort */
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    if (tempFile && !committed) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
    }
  }
}

// Limited test hooks keep cache-boundary regression tests independent of HTTP
// rendering and do not affect the route contract.
export const ogCacheTestHooks = {
  cacheKey,
  cacheFilePath,
  readCached,
  writeCached,
  get cacheDir(): string {
    return ogCacheDir;
  },
  setCacheDirForTest(dir: string): void {
    ogCacheDir = path.resolve(dir);
  },
};

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

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
} as const;

function serveSvgResponse(
  key: string,
  template: Template,
  slug: string,
  customTitle: string | undefined,
  res: Response
): void {
  let buf = readCached(key, "svg");
  const hit = !!buf;
  if (!buf) {
    buf = Buffer.from(renderSvg(template, slug, customTitle), "utf8");
    writeCached(key, "svg", buf);
  }
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_HEADERS["Cache-Control"]);
  res.setHeader("X-Og-Cache", hit ? "HIT" : "MISS");
  res.setHeader("ETag", `"${key}-svg"`);
  res.send(buf);
}

async function servePngResponse(
  key: string,
  template: Template,
  slug: string,
  customTitle: string | undefined,
  res: Response
): Promise<void> {
  let buf = readCached(key, "png");
  const hit = !!buf;
  if (!buf) {
    const svgBuf = Buffer.from(renderSvg(template, slug, customTitle), "utf8");
    const rendered = await sharp(svgBuf).png().toBuffer();
    if (!rendered) throw new Error("Sharp returned no PNG output");
    buf = rendered;
    writeCached(key, "png", rendered);
  }
  if (!buf) throw new Error("PNG response buffer unavailable");
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", CACHE_HEADERS["Cache-Control"]);
  res.setHeader("X-Og-Cache", hit ? "HIT" : "MISS");
  res.setHeader("ETag", `"${key}-png"`);
  res.send(buf);
}

function sendOgError(res: Response): void {
  // Keep both response formats and server diagnostics deliberately generic:
  // cache keys can encode titles and must never be exposed in diagnostics.
  console.error("[OG] image generation failed");
  res.status(500).json({ error: "OG image render failed" });
}

export function registerOgRoutes(app: Express) {
  // SVG endpoint
  app.get("/og/:template/:slug.svg", (req, res) => {
    try {
      const template = resolveTemplate(String(req.params.template || "default"));
      const slug = String(req.params.slug || "");
      const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;
      const key = cacheKey(template, slug, customTitle);
      serveSvgResponse(key, template, slug, customTitle, res);
    } catch {
      sendOgError(res);
    }
  });

  // PNG endpoint — rasterized from SVG via sharp (1200×630 branded card)
  app.get("/og/:template/:slug.png", async (req, res) => {
    const template = resolveTemplate(String(req.params.template || "default"));
    const slug = String(req.params.slug || "");
    const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;
    const key = cacheKey(template, slug, customTitle);
    try {
      await servePngResponse(key, template, slug, customTitle, res);
    } catch {
      sendOgError(res);
    }
  });

  // Legacy bare route (no extension) — SVG for backward compatibility
  app.get("/og/:template/:slug", (req, res) => {
    try {
      const template = resolveTemplate(String(req.params.template || "default"));
      const slug = String(req.params.slug || "").replace(/\.(svg|png)$/i, "");
      const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;
      const key = cacheKey(template, slug, customTitle);
      serveSvgResponse(key, template, slug, customTitle, res);
    } catch {
      sendOgError(res);
    }
  });
}
