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

// ── PNG generation with embedded bitmap font ─────────────────────────────────
// Generates a proper image/png (1200×630) with per-page title text rendered
// using an 8×8 pixel bitmap font (classic VGA style). No native modules needed.

// 8×8 bitmap font for printable ASCII 0x20–0x7E.
// Each entry is 8 bytes: one byte per row (bit 7 = leftmost pixel).
const FONT8: Record<number, number[]> = {
  0x20: [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00], // space
  0x21: [0x18,0x18,0x18,0x18,0x18,0x00,0x18,0x00], // !
  0x22: [0x66,0x66,0x44,0x00,0x00,0x00,0x00,0x00], // "
  0x23: [0x6C,0x6C,0xFE,0x6C,0xFE,0x6C,0x6C,0x00], // #
  0x24: [0x18,0x3E,0x60,0x3C,0x06,0x7C,0x18,0x00], // $
  0x25: [0xC6,0xCC,0x18,0x30,0x66,0xC6,0x00,0x00], // %
  0x26: [0x38,0x6C,0x38,0x76,0xDC,0xCC,0x76,0x00], // &
  0x27: [0x18,0x18,0x30,0x00,0x00,0x00,0x00,0x00], // '
  0x28: [0x0C,0x18,0x30,0x30,0x30,0x18,0x0C,0x00], // (
  0x29: [0x30,0x18,0x0C,0x0C,0x0C,0x18,0x30,0x00], // )
  0x2A: [0x00,0x66,0x3C,0xFF,0x3C,0x66,0x00,0x00], // *
  0x2B: [0x00,0x18,0x18,0x7E,0x18,0x18,0x00,0x00], // +
  0x2C: [0x00,0x00,0x00,0x00,0x18,0x18,0x30,0x00], // ,
  0x2D: [0x00,0x00,0x00,0x7E,0x00,0x00,0x00,0x00], // -
  0x2E: [0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00], // .
  0x2F: [0x06,0x0C,0x18,0x30,0x60,0xC0,0x00,0x00], // /
  0x30: [0x3C,0x66,0x6E,0x76,0x66,0x66,0x3C,0x00], // 0
  0x31: [0x18,0x38,0x18,0x18,0x18,0x18,0x7E,0x00], // 1
  0x32: [0x3C,0x66,0x06,0x0C,0x18,0x30,0x7E,0x00], // 2
  0x33: [0x3C,0x66,0x06,0x1C,0x06,0x66,0x3C,0x00], // 3
  0x34: [0x0C,0x1C,0x3C,0x6C,0x7E,0x0C,0x0C,0x00], // 4
  0x35: [0x7E,0x60,0x7C,0x06,0x06,0x66,0x3C,0x00], // 5
  0x36: [0x3C,0x66,0x60,0x7C,0x66,0x66,0x3C,0x00], // 6
  0x37: [0x7E,0x06,0x0C,0x18,0x30,0x30,0x30,0x00], // 7
  0x38: [0x3C,0x66,0x66,0x3C,0x66,0x66,0x3C,0x00], // 8
  0x39: [0x3C,0x66,0x66,0x3E,0x06,0x66,0x3C,0x00], // 9
  0x3A: [0x00,0x18,0x18,0x00,0x18,0x18,0x00,0x00], // :
  0x3B: [0x00,0x18,0x18,0x00,0x18,0x18,0x30,0x00], // ;
  0x3C: [0x0E,0x1C,0x38,0x70,0x38,0x1C,0x0E,0x00], // <
  0x3D: [0x00,0x00,0x7E,0x00,0x7E,0x00,0x00,0x00], // =
  0x3E: [0x70,0x38,0x1C,0x0E,0x1C,0x38,0x70,0x00], // >
  0x3F: [0x3C,0x66,0x06,0x0C,0x18,0x00,0x18,0x00], // ?
  0x40: [0x3C,0x66,0x6E,0x6A,0x6E,0x60,0x3C,0x00], // @
  0x41: [0x18,0x3C,0x66,0x7E,0x66,0x66,0x66,0x00], // A
  0x42: [0x7C,0x66,0x66,0x7C,0x66,0x66,0x7C,0x00], // B
  0x43: [0x3C,0x66,0x60,0x60,0x60,0x66,0x3C,0x00], // C
  0x44: [0x78,0x6C,0x66,0x66,0x66,0x6C,0x78,0x00], // D
  0x45: [0x7E,0x60,0x60,0x7C,0x60,0x60,0x7E,0x00], // E
  0x46: [0x7E,0x60,0x60,0x7C,0x60,0x60,0x60,0x00], // F
  0x47: [0x3C,0x66,0x60,0x6E,0x66,0x66,0x3E,0x00], // G
  0x48: [0x66,0x66,0x66,0x7E,0x66,0x66,0x66,0x00], // H
  0x49: [0x3C,0x18,0x18,0x18,0x18,0x18,0x3C,0x00], // I
  0x4A: [0x1E,0x0C,0x0C,0x0C,0x0C,0x6C,0x38,0x00], // J
  0x4B: [0x66,0x6C,0x78,0x70,0x78,0x6C,0x66,0x00], // K
  0x4C: [0x60,0x60,0x60,0x60,0x60,0x60,0x7E,0x00], // L
  0x4D: [0x63,0x77,0x7F,0x6B,0x63,0x63,0x63,0x00], // M
  0x4E: [0x66,0x76,0x7E,0x6E,0x66,0x66,0x66,0x00], // N
  0x4F: [0x3C,0x66,0x66,0x66,0x66,0x66,0x3C,0x00], // O
  0x50: [0x7C,0x66,0x66,0x7C,0x60,0x60,0x60,0x00], // P
  0x51: [0x3C,0x66,0x66,0x66,0x6E,0x6C,0x36,0x00], // Q
  0x52: [0x7C,0x66,0x66,0x7C,0x78,0x6C,0x66,0x00], // R
  0x53: [0x3C,0x66,0x60,0x3C,0x06,0x66,0x3C,0x00], // S
  0x54: [0x7E,0x18,0x18,0x18,0x18,0x18,0x18,0x00], // T
  0x55: [0x66,0x66,0x66,0x66,0x66,0x66,0x3C,0x00], // U
  0x56: [0x66,0x66,0x66,0x66,0x66,0x3C,0x18,0x00], // V
  0x57: [0x63,0x63,0x63,0x6B,0x7F,0x77,0x63,0x00], // W
  0x58: [0x66,0x66,0x3C,0x18,0x3C,0x66,0x66,0x00], // X
  0x59: [0x66,0x66,0x66,0x3C,0x18,0x18,0x18,0x00], // Y
  0x5A: [0x7E,0x06,0x0C,0x18,0x30,0x60,0x7E,0x00], // Z
  0x5B: [0x3C,0x30,0x30,0x30,0x30,0x30,0x3C,0x00], // [
  0x5C: [0xC0,0x60,0x30,0x18,0x0C,0x06,0x00,0x00], // backslash
  0x5D: [0x3C,0x0C,0x0C,0x0C,0x0C,0x0C,0x3C,0x00], // ]
  0x5E: [0x18,0x3C,0x66,0x00,0x00,0x00,0x00,0x00], // ^
  0x5F: [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFF], // _
  0x60: [0x18,0x18,0x0C,0x00,0x00,0x00,0x00,0x00], // `
  // Lowercase a-z map to uppercase glyphs (fold below)
  0x61: [0x00,0x00,0x3C,0x06,0x3E,0x66,0x3E,0x00], // a
  0x62: [0x60,0x60,0x7C,0x66,0x66,0x66,0x7C,0x00], // b
  0x63: [0x00,0x00,0x3C,0x66,0x60,0x66,0x3C,0x00], // c
  0x64: [0x06,0x06,0x3E,0x66,0x66,0x66,0x3E,0x00], // d
  0x65: [0x00,0x00,0x3C,0x66,0x7E,0x60,0x3C,0x00], // e
  0x66: [0x1C,0x30,0x30,0x7C,0x30,0x30,0x30,0x00], // f
  0x67: [0x00,0x00,0x3E,0x66,0x66,0x3E,0x06,0x3C], // g
  0x68: [0x60,0x60,0x7C,0x66,0x66,0x66,0x66,0x00], // h
  0x69: [0x18,0x00,0x38,0x18,0x18,0x18,0x3C,0x00], // i
  0x6A: [0x0C,0x00,0x1C,0x0C,0x0C,0x0C,0x6C,0x38], // j
  0x6B: [0x60,0x60,0x66,0x6C,0x78,0x6C,0x66,0x00], // k
  0x6C: [0x38,0x18,0x18,0x18,0x18,0x18,0x3C,0x00], // l
  0x6D: [0x00,0x00,0x66,0x7F,0x6B,0x63,0x63,0x00], // m
  0x6E: [0x00,0x00,0x7C,0x66,0x66,0x66,0x66,0x00], // n
  0x6F: [0x00,0x00,0x3C,0x66,0x66,0x66,0x3C,0x00], // o
  0x70: [0x00,0x00,0x7C,0x66,0x66,0x7C,0x60,0x60], // p
  0x71: [0x00,0x00,0x3E,0x66,0x66,0x3E,0x06,0x06], // q
  0x72: [0x00,0x00,0x6C,0x76,0x60,0x60,0x60,0x00], // r
  0x73: [0x00,0x00,0x3E,0x60,0x3C,0x06,0x7C,0x00], // s
  0x74: [0x18,0x18,0x7E,0x18,0x18,0x18,0x0E,0x00], // t
  0x75: [0x00,0x00,0x66,0x66,0x66,0x66,0x3E,0x00], // u
  0x76: [0x00,0x00,0x66,0x66,0x66,0x3C,0x18,0x00], // v
  0x77: [0x00,0x00,0x63,0x6B,0x7F,0x77,0x63,0x00], // w
  0x78: [0x00,0x00,0x66,0x3C,0x18,0x3C,0x66,0x00], // x
  0x79: [0x00,0x00,0x66,0x66,0x66,0x3E,0x06,0x3C], // y
  0x7A: [0x00,0x00,0x7E,0x0C,0x18,0x30,0x7E,0x00], // z
  0x7B: [0x0E,0x18,0x18,0x70,0x18,0x18,0x0E,0x00], // {
  0x7C: [0x18,0x18,0x18,0x18,0x18,0x18,0x18,0x00], // |
  0x7D: [0x70,0x18,0x18,0x0E,0x18,0x18,0x70,0x00], // }
  0x7E: [0x76,0xDC,0x00,0x00,0x00,0x00,0x00,0x00], // ~
};

const FALLBACK_GLYPH = FONT8[0x3F]!; // '?'

function getGlyph(ch: string): number[] {
  const code = ch.charCodeAt(0);
  return FONT8[code] ?? FALLBACK_GLYPH;
}

// Draw one character at (cx, cy) on the flat RGB pixel buffer.
// `scale` controls pixel magnification (e.g. 4 → each font pixel = 4×4 screen pixels).
function drawChar(
  buf: Uint8Array, W: number,
  cx: number, cy: number,
  ch: string, scale: number,
  r: number, g: number, b: number
) {
  const glyph = getGlyph(ch);
  for (let row = 0; row < 8; row++) {
    const rowByte = glyph[row] ?? 0;
    for (let col = 0; col < 8; col++) {
      const on = (rowByte >> (7 - col)) & 1;
      if (!on) continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = cx + col * scale + sx;
          const py = cy + row * scale + sy;
          if (px < 0 || px >= W || py < 0) continue;
          const idx = (py * W + px) * 3;
          buf[idx]     = r;
          buf[idx + 1] = g;
          buf[idx + 2] = b;
        }
      }
    }
  }
}

function drawText(
  buf: Uint8Array, W: number,
  x: number, y: number,
  text: string, scale: number,
  r: number, g: number, b: number
) {
  let cx = x;
  for (const ch of text) {
    drawChar(buf, W, cx, y, ch, scale, r, g, b);
    cx += 8 * scale + scale; // char width + 1px gap
  }
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + " " + w).length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === 2) break; // max 3 lines
    }
  }
  if (cur && lines.length < 3) lines.push(cur);
  return lines;
}

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
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff]! ^ (crc >>> 8);
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

function renderOgPng(template: Template, slug: string, customTitle?: string): Buffer {
  const W = 1200;
  const H = 630;
  const [fromHex, toHex] = TEMPLATE_GRADIENTS[template] ?? TEMPLATE_GRADIENTS.default;
  const label = (TEMPLATE_LABEL[template] ?? "Liberty Bancard").toUpperCase();
  const title = (customTitle || unslugify(slug) || "Liberty Bancard").slice(0, 120);

  const [r1, g1, b1] = hexToRgb(fromHex);
  const [r2, g2, b2] = hexToRgb(toHex);

  // Build flat RGB pixel buffer (3 bytes per pixel, row-major)
  const pixels = new Uint8Array(W * H * 3);

  // --- Diagonal gradient background ---
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = (x / (W - 1) + y / (H - 1)) / 2;
      const idx = (y * W + x) * 3;
      pixels[idx]     = lerp(r1, r2, t);
      pixels[idx + 1] = lerp(g1, g2, t);
      pixels[idx + 2] = lerp(b1, b2, t);
    }
  }

  // --- Top accent bar (sky-blue, 6px) ---
  const accentR = 14, accentG = 165, accentB = 233;
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      pixels[idx]     = accentR;
      pixels[idx + 1] = accentG;
      pixels[idx + 2] = accentB;
    }
  }

  // --- Render text (white) using bitmap font ---
  const SCALE = 5;            // 8×5 = 40px per char width, 8×5=40px tall
  const CHAR_W = 8 * SCALE + SCALE; // char + gap = 45px
  const CHAR_H = 8 * SCALE;         // 40px tall

  // Label line (template name, smaller)
  const LABEL_SCALE = 3;
  const LABEL_CHAR_W = 8 * LABEL_SCALE + LABEL_SCALE;
  drawText(pixels, W, 60, 60, label, LABEL_SCALE, 255, 255, 255);

  // Title lines (wraps at ~22 chars per line to keep within 1080px)
  const MAX_CHARS = Math.floor((W - 120) / CHAR_W);
  const lines = wrapLines(title, Math.max(MAX_CHARS, 12));
  const totalTextH = lines.length * CHAR_H + (lines.length - 1) * SCALE * 2;
  const startY = Math.round((H - totalTextH) / 2) - 20;

  lines.forEach((line, i) => {
    const ty = startY + i * (CHAR_H + SCALE * 2);
    drawText(pixels, W, 60, ty, line, SCALE, 255, 255, 255);
  });

  // Domain line at bottom
  drawText(pixels, W, 60, H - 80, "libertybancard.com", LABEL_SCALE, 255, 255, 255);

  // --- Accent badge (bottom-right) ---
  const badgeX = W - 200, badgeY = H - 80;
  const badgeTxt = "LIBERTY";
  for (let y = badgeY - 10; y < badgeY + CHAR_H + 10; y++) {
    for (let x = badgeX - 16; x < badgeX + badgeTxt.length * LABEL_CHAR_W + 16; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const idx = (y * W + x) * 3;
      pixels[idx]     = accentR;
      pixels[idx + 1] = accentG;
      pixels[idx + 2] = accentB;
    }
  }
  drawText(pixels, W, badgeX, badgeY, badgeTxt, LABEL_SCALE, 255, 255, 255);

  // --- Encode as PNG ---
  const rows: Buffer[] = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    row[0] = 0; // filter: None
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 3;
      row[1 + x * 3]     = pixels[src]!;
      row[1 + x * 3 + 1] = pixels[src + 1]!;
      row[1 + x * 3 + 2] = pixels[src + 2]!;
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: 6 });

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
  // SVG endpoint — rich vector text layout, default for og:image in SEO.tsx
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

  // PNG endpoint — proper image/png with per-page title text rendered via
  // an embedded 8×8 bitmap font (no native deps). Used by platforms that
  // require raster images (Twitter/X, Slack, some Discord embeds).
  app.get("/og/:template/:slug.png", (req, res) => {
    const rawTemplate = String(req.params.template || "default").toLowerCase();
    const template = (TEMPLATES.includes(rawTemplate as Template) ? rawTemplate : "default") as Template;
    const slugParam = String(req.params.slug || "");
    const customTitle = typeof req.query.title === "string" ? req.query.title : undefined;

    const cacheKey = ogCacheKey(template, slugParam, customTitle);
    let pngBuf = readCached(cacheKey, "png");
    const cacheHit = !!pngBuf;
    if (!pngBuf) {
      pngBuf = renderOgPng(template, slugParam, customTitle);
      writeCached(cacheKey, "png", pngBuf);
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
    res.setHeader("X-Og-Cache", cacheHit ? "HIT" : "MISS");
    res.setHeader("ETag", `"${cacheKey}-png"`);
    res.send(pngBuf);
  });

  // Legacy bare route (no extension) → SVG for backward compatibility
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
