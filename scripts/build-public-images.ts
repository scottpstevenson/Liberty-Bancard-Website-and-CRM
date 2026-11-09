/**
 * Public-site imagery pipeline.
 *
 * Reads the committed originals under client/src/assets/images, cuts the art-directed
 * crops defined below, and writes AVIF / WebP / JPEG derivatives plus a manifest to
 * client/public/images/public/. The manifest (width, height, bytes per file) is what
 * `client/src/lib/public-imagery.ts` reads, so explicit dimensions and srcset widths
 * never drift from the files on disk.
 *
 *   npx tsx scripts/build-public-images.ts            # rebuild all derivatives + manifest
 *   npx tsx scripts/build-public-images.ts --check    # fail if a derivative/manifest is stale or over budget
 *
 * Provenance and suitability notes live in public-imagery.ts next to the display data;
 * this file only owns geometry and encoding. Sources stay untouched and committed.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "client/src/assets/images");
const OUT_DIR = path.join(ROOT, "client/public/images/public");
const MANIFEST = path.join(ROOT, "client/src/lib/public-imagery.manifest.json");

type Crop = { left: number; top: number; width: number; height: number };
interface Variant {
  /** Variant id, e.g. "mobile" or "desktop". */
  name: string;
  crop: Crop;
  /** Output widths (px); never larger than the crop. */
  widths: number[];
  /** Source has real transparency: AVIF/WebP keep it, the JPEG fallback is flattened onto this colour. */
  flattenJpegOn?: string;
}
interface Source {
  id: string;
  file: string;
  variants: Variant[];
}

/** Crops are in source pixels. 4:3 card crops keep the focal subject; see public-imagery.ts for notes. */
const SOURCES: Source[] = [
  {
    id: "hero-terminal-tap",
    file: "liberty-terminal-tap.png", // 1280x896
    variants: [
      { name: "mobile", crop: { left: 85, top: 0, width: 1195, height: 896 }, widths: [480, 720, 960] }, // 4:3, whole payment moment
      { name: "desktop", crop: { left: 220, top: 0, width: 1060, height: 896 }, widths: [520, 780, 1060] }, // ~1.18
    ],
  },
  {
    id: "industry-restaurant",
    file: "case-restaurant.jpg", // 1280x853
    variants: [{ name: "card", crop: { left: 0, top: 0, width: 1137, height: 853 }, widths: [320, 480, 640] }],
  },
  {
    id: "industry-healthcare",
    file: "vertical-medical.jpg", // 1280x720
    variants: [{ name: "card", crop: { left: 320, top: 0, width: 960, height: 720 }, widths: [320, 480, 640] }],
  },
  {
    id: "industry-automotive",
    file: "case-auto.jpg", // 1280x853
    variants: [{ name: "card", crop: { left: 100, top: 0, width: 1137, height: 853 }, widths: [320, 480, 640] }],
  },
  {
    id: "industry-retail",
    file: "case-retail.jpg", // 1280x884
    variants: [{ name: "card", crop: { left: 50, top: 0, width: 1179, height: 884 }, widths: [320, 480, 640] }],
  },
  {
    id: "how-statement-review",
    file: "statement-review.jpg", // 1280x848
    variants: [
      { name: "wide", crop: { left: 0, top: 64, width: 1280, height: 720 }, widths: [480, 800, 1200] }, // 16:9
    ],
  },
  // Terminal product shots (transparent cut-outs). Full frame, two widths: the originals were served at
  // 0.7-1.1 MB each on the terminal, program, comparison, quiz and shop pages.
  {
    id: "product-clover-flex-3",
    file: "terminal-clover-flex-3.png", // 896x1280
    variants: [{ name: "product", crop: { left: 0, top: 0, width: 896, height: 1280 }, widths: [320, 640], flattenJpegOn: "#ffffff" }],
  },
  {
    id: "product-pax-a920",
    file: "terminal-pax-a920.png", // 896x1280
    variants: [{ name: "product", crop: { left: 0, top: 0, width: 896, height: 1280 }, widths: [320, 640], flattenJpegOn: "#ffffff" }],
  },
  {
    id: "product-clover-mini-3",
    file: "terminal-clover-mini-3.png", // 896x1280
    variants: [{ name: "product", crop: { left: 0, top: 0, width: 896, height: 1280 }, widths: [320, 640], flattenJpegOn: "#ffffff" }],
  },
  {
    id: "product-clover-station-duo",
    file: "terminal-clover-station-duo.png", // 1280x896
    variants: [{ name: "product", crop: { left: 0, top: 0, width: 1280, height: 896 }, widths: [320, 640], flattenJpegOn: "#ffffff" }],
  },
  {
    id: "product-dejavoo-qd4",
    file: "terminal-dejavoo-qd4.png", // 896x1280
    variants: [{ name: "product", crop: { left: 0, top: 0, width: 896, height: 1280 }, widths: [320, 640], flattenJpegOn: "#ffffff" }],
  },
  {
    id: "product-swipesimple-b250",
    file: "terminal-swipesimple-b250.png", // 896x1280
    variants: [{ name: "product", crop: { left: 0, top: 0, width: 896, height: 1280 }, widths: [320, 640], flattenJpegOn: "#ffffff" }],
  },
];

const FORMATS = ["avif", "webp", "jpg"] as const;
type Format = (typeof FORMATS)[number];
/** Encoder quality per format, tuned for photography at these sizes. */
const QUALITY: Record<Format, number> = { avif: 52, webp: 74, jpg: 76 };
/** Budget for the principal above-the-fold mobile derivative (audit: roughly 70-120 KB). */
const HERO_MOBILE_BUDGET = { file: "hero-terminal-tap-mobile-720.webp", maxBytes: 120 * 1024 };

interface ManifestFile { format: Format; file: string; width: number; height: number; bytes: number }
interface ManifestVariant { name: string; width: number; height: number; files: ManifestFile[] }
interface ManifestEntry { id: string; source: string; sourceSha256: string; variants: ManifestVariant[] }

async function build(): Promise<ManifestEntry[]> {
  mkdirSync(OUT_DIR, { recursive: true });
  const wanted = new Set<string>();
  const entries: ManifestEntry[] = [];
  for (const src of SOURCES) {
    const srcPath = path.join(SRC_DIR, src.file);
    const buf = readFileSync(srcPath);
    const meta = await sharp(buf).metadata();
    const entry: ManifestEntry = { id: src.id, source: `client/src/assets/images/${src.file}`, sourceSha256: createHash("sha256").update(buf).digest("hex"), variants: [] };
    for (const variant of src.variants) {
      const c = variant.crop;
      if (c.left + c.width > meta.width! || c.top + c.height > meta.height!) throw new Error(`${src.id}/${variant.name}: crop exceeds ${src.file} (${meta.width}x${meta.height})`);
      const aspect = c.width / c.height;
      const mv: ManifestVariant = { name: variant.name, width: c.width, height: c.height, files: [] };
      for (const width of variant.widths) {
        const w = Math.min(width, c.width);
        const h = Math.round(w / aspect);
        for (const format of FORMATS) {
          const file = `${src.id}-${variant.name}-${width}.${format}`;
          let pipe = sharp(buf).extract(c).resize(w, h, { fit: "fill" });
          if (format === "jpg" && variant.flattenJpegOn) pipe = pipe.flatten({ background: variant.flattenJpegOn });
          if (format === "avif") pipe = pipe.avif({ quality: QUALITY.avif, effort: 6 });
          else if (format === "webp") pipe = pipe.webp({ quality: QUALITY.webp, effort: 6 });
          else pipe = pipe.jpeg({ quality: QUALITY.jpg, mozjpeg: true });
          const out = await pipe.toBuffer();
          writeFileSync(path.join(OUT_DIR, file), out);
          wanted.add(file);
          mv.files.push({ format, file, width: w, height: h, bytes: out.length });
        }
      }
      entry.variants.push(mv);
    }
    entries.push(entry);
  }
  // Remove derivatives that no longer belong to any definition.
  for (const f of readdirSync(OUT_DIR)) if (!wanted.has(f)) rmSync(path.join(OUT_DIR, f));
  return entries;
}

function budgetProblems(entries: ManifestEntry[]): string[] {
  const problems: string[] = [];
  const all = entries.flatMap((e) => e.variants.flatMap((v) => v.files));
  const hero = all.find((f) => f.file === HERO_MOBILE_BUDGET.file);
  if (!hero) problems.push(`budget file ${HERO_MOBILE_BUDGET.file} missing`);
  else if (hero.bytes > HERO_MOBILE_BUDGET.maxBytes) problems.push(`${hero.file} is ${hero.bytes} bytes (> ${HERO_MOBILE_BUDGET.maxBytes})`);
  for (const f of all) if (f.bytes > 260 * 1024) problems.push(`${f.file} is ${f.bytes} bytes (> 260 KB)`);
  return problems;
}

(async () => {
  const check = process.argv.includes("--check") || process.env.PUBLIC_IMAGES_CHECK === "1";
  if (check) {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { entries: ManifestEntry[] };
    const problems = budgetProblems(manifest.entries);
    for (const e of manifest.entries) {
      const src = path.join(ROOT, e.source);
      if (!existsSync(src)) problems.push(`${e.id}: source ${e.source} missing`);
      else if (createHash("sha256").update(readFileSync(src)).digest("hex") !== e.sourceSha256) problems.push(`${e.id}: source changed since derivatives were built`);
      for (const v of e.variants) for (const f of v.files) {
        const p = path.join(OUT_DIR, f.file);
        if (!existsSync(p)) problems.push(`${f.file} missing`);
        else if (statSync(p).size !== f.bytes) problems.push(`${f.file} differs from manifest`);
      }
    }
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`public imagery ok: ${manifest.entries.length} sources`);
    return;
  }
  const entries = await build();
  const problems = budgetProblems(entries);
  writeFileSync(MANIFEST, JSON.stringify({ generatedBy: "scripts/build-public-images.ts", quality: QUALITY, entries }, null, 2) + "\n");
  const bytes = entries.flatMap((e) => e.variants.flatMap((v) => v.files)).reduce((n, f) => n + f.bytes, 0);
  console.log(`wrote ${entries.length} sources, ${(bytes / 1024).toFixed(0)} KB total`);
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
})();
