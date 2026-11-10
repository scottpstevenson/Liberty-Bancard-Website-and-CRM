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
import { HERO_MOBILE_BUDGET, budgetProblems, heroSelectorProblems } from "./lib/public-image-budget";
import { HOME_HERO_IMAGE } from "../shared/public-home-content";

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

/**
 * 4:3 card crop of a 1536x1024 W-D master: full height, 1365 px wide, centred on the supplied focal
 * x (docs/media/w-d-asset-pack-2026-11-10/asset-manifest.json) and clamped to the frame.
 */
const W_D_FRAME = { width: 1536, height: 1024 } as const;
function cardCrop(focalX: number): Crop {
  const width = Math.round((W_D_FRAME.height * 4) / 3);
  const left = Math.min(W_D_FRAME.width - width, Math.max(0, Math.round(W_D_FRAME.width * focalX - width / 2)));
  return { left, top: 0, width, height: W_D_FRAME.height };
}
const CARD_WIDTHS = [320, 480, 640, 800];
function wdPhoto(id: string, file: string, focalX: number): Source {
  return { id, file: `w-d/${file}`, variants: [{ name: "card", crop: cardCrop(focalX), widths: CARD_WIDTHS }] };
}

/** Crops are in source pixels. Focal notes live with each master in docs/media/w-d-asset-pack-2026-11-10. */
const SOURCES: Source[] = [
  {
    // Home hero (LCP). Phones get an intentional 4:3 crop below the actions; from lg the full 3:2 frame is inset beside the copy.
    id: "home-hero-merchant",
    file: "w-d/01-home-merchant-hero.png", // 1536x1024, focal 50% 50%
    variants: [
      { name: "mobile", crop: cardCrop(0.5), widths: [480, 720, 960] },
      { name: "desktop", crop: { left: 0, top: 0, width: 1536, height: 1024 }, widths: [520, 780, 1040] },
    ],
  },
  wdPhoto("industry-restaurant", "02-restaurant-service.png", 0.55),
  wdPhoto("industry-dental", "03-dental-front-desk.png", 0.52),
  wdPhoto("industry-med-spa", "04-medspa-consultation.png", 0.5),
  wdPhoto("industry-automotive", "05-automotive-workshop.png", 0.52),
  wdPhoto("industry-retail", "06-retail-record-shop.png", 0.5),
  wdPhoto("industry-field-services", "07-field-services.png", 0.48),
  wdPhoto("industry-ecommerce", "08-ecommerce-packing.png", 0.5),
  wdPhoto("industry-professional-services", "09-professional-services.png", 0.52),
  {
    // Why Liberty process inset: full 3:2 frame (the overhead composition keeps its breathing space).
    id: "process-review-hands",
    file: "w-d/10-review-process.png", // 1536x1024
    variants: [{ name: "wide", crop: { left: 0, top: 0, width: 1536, height: 1024 }, widths: [480, 800, 1200] }],
  },
  {
    // Upright terminal concept with real alpha: AVIF/WebP keep it, the JPEG fallback is flattened on the white card it sits on.
    id: "equipment-concept-terminal-upright",
    file: "w-d/13-terminal-upright.png", // 1024x1536
    variants: [{ name: "product", crop: { left: 0, top: 0, width: 1024, height: 1536 }, widths: [220, 440], flattenJpegOn: "#ffffff" }],
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

(async () => {
  const check = process.argv.includes("--check") || process.env.PUBLIC_IMAGES_CHECK === "1";
  if (check) {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { entries: ManifestEntry[] };
    const problems = [...budgetProblems(manifest.entries), ...heroSelectorProblems(HERO_MOBILE_BUDGET, { id: HOME_HERO_IMAGE.id, mobileVariant: HOME_HERO_IMAGE.mobile.variant })];
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
  const problems = [...budgetProblems(entries), ...heroSelectorProblems(HERO_MOBILE_BUDGET, { id: HOME_HERO_IMAGE.id, mobileVariant: HOME_HERO_IMAGE.mobile.variant })];
  writeFileSync(MANIFEST, JSON.stringify({ generatedBy: "scripts/build-public-images.ts", quality: QUALITY, entries }, null, 2) + "\n");
  const bytes = entries.flatMap((e) => e.variants.flatMap((v) => v.files)).reduce((n, f) => n + f.bytes, 0);
  console.log(`wrote ${entries.length} sources, ${(bytes / 1024).toFixed(0)} KB total`);
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
})();
