import manifest from "./public-imagery.manifest.json";

/**
 * Public imagery registry.
 *
 * Geometry (crops, widths, byte sizes) comes from the generated manifest written by
 * scripts/build-public-images.ts, so explicit width/height and srcset widths cannot
 * drift from the derivative files in client/public/images/public/. This module adds
 * what the pipeline cannot know: alt text, how each image may be used, and its
 * provenance.
 *
 * Provenance policy. Two kinds of image are registered.
 *  - `unverified`: originals committed before this registry existed (the terminal product shots). None
 *    carries a licence record, so they are used only as `illustrative` imagery (never a named customer,
 *    a quoted merchant, or a claim about a real business) and are never relabelled as licensed.
 *  - `generated`: the W-D editorial photographs and the upright terminal concept. These are synthetic
 *    scenes produced with an image-generation tool; each record carries the pack asset id, the master's
 *    sha256, and where the exact generation prompt is kept (docs/media/w-d-asset-pack-2026-11-10/).
 *    They are never described as licensed photographs, real merchants, Liberty staff or Liberty
 *    customers, and `approval` stays `owner-review-pending` until the owner accepts them.
 * Replacing an image with a licensed or commissioned photo means adding the source to
 * build-public-images.ts and updating its record here; no page code changes.
 *
 * Retired from the registry by W-D: the earlier hero render, the stethoscope front-desk photo and the
 * desk-of-charts photo. They remain on disk for older pages that import them directly.
 *
 * Excluded on purpose (see the mobile audit's imagery table): hero-merchant.jpg
 * (grocery aisle with foreign-language price tags), merchant-owner.jpg,
 * vertical-auto.jpg, vertical-retail.jpg (shopping carts), vertical-home-services.jpg
 * (restroom fixtures) and case-medical.jpg. They remain on disk for pages that
 * already use them.
 */
export type PublicImageId =
  | "home-hero-merchant"
  | "industry-restaurant"
  | "industry-dental"
  | "industry-med-spa"
  | "industry-automotive"
  | "industry-retail"
  | "industry-field-services"
  | "industry-ecommerce"
  | "industry-professional-services"
  | "process-review-hands"
  | "equipment-concept-terminal-upright"
  | "product-clover-flex-3"
  | "product-pax-a920"
  | "product-clover-mini-3"
  | "product-clover-station-duo"
  | "product-dejavoo-qd4"
  | "product-swipesimple-b250";

export type ImageProvenance = "unverified" | "generated";
export type ImageUsage = "illustrative" | "illustrative-equipment-only";

interface ManifestFile { format: "avif" | "webp" | "jpg"; file: string; width: number; height: number; bytes: number }
interface ManifestVariant { name: string; width: number; height: number; files: ManifestFile[] }
interface ManifestEntry { id: string; source: string; sourceSha256: string; variants: ManifestVariant[] }

export interface PublicImageRecord {
  id: PublicImageId;
  alt: string;
  /** Short visible label for image-backed cards. */
  label?: string;
  usage: ImageUsage;
  provenance: ImageProvenance;
  /** What the picture shows and why it is allowed in that slot. */
  note: string;
  /** Present exactly when provenance is "generated": the supplied pack asset and where its prompt is kept. */
  generation?: PublicImageGeneration;
}

export interface PublicImageGeneration {
  /** Asset id inside the W-D pack (asset-manifest.json). */
  assetId: string;
  /** sha256 of the unmodified master; must equal the manifest's sourceSha256. */
  sha256: string;
  /** Repository path of the generation record that holds the exact prompt. */
  record: string;
  approval: "owner-review-pending";
}

export const PUBLIC_IMAGE_RECORDS: Record<PublicImageId, PublicImageRecord> = {
  "home-hero-merchant": {
    id: "home-hero-merchant",
    alt: "Boutique owner preparing a bag while a customer taps a phone at checkout.",
    usage: "illustrative",
    provenance: "generated",
    note: "Home hero. Generated editorial scene (owner review pending); not a photograph of a real business, customer or Liberty staff. Shows an unbranded payment reader and no readable data.",
    generation: { assetId: "01-home-merchant-hero", sha256: "04fdea12ab44289e0c359ad536aca034f1e4ea891cc64685c9b4feeeae2b19ec", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "industry-restaurant": {
    id: "industry-restaurant",
    alt: "Restaurant server and operator reviewing an order during service.",
    label: "Restaurants",
    usage: "illustrative",
    provenance: "generated",
    note: "Home card and restaurant page. Generated editorial scene (owner review pending); not a photograph of a real business, customer or Liberty staff.",
    generation: { assetId: "02-restaurant-service", sha256: "ed5f7c9c592e3fe96c7d579cd380dafad24ce248e966db42a694e6506a530822", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "industry-dental": {
    id: "industry-dental",
    alt: "Dental office coordinator explaining a folder to a visitor at reception.",
    label: "Dental",
    usage: "illustrative",
    provenance: "generated",
    note: "Home card and dental page. Generated editorial scene (owner review pending); not a photograph of a real business, customer or Liberty staff. No clinical data or patient records.",
    generation: { assetId: "03-dental-front-desk", sha256: "bdb339323411164a9c66c2844832bab42d7bc1e615e53dd4e4735ecebce77a7e", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "industry-med-spa": {
    id: "industry-med-spa",
    alt: "Clinic manager and client discussing an information booklet.",
    label: "Med spa",
    usage: "illustrative",
    provenance: "generated",
    note: "Home card and med-spa page. Generated editorial scene (owner review pending); not a photograph of a real business, customer or Liberty staff. No treatment claims or before/after imagery.",
    generation: { assetId: "04-medspa-consultation", sha256: "7f19a843e89d7556a8e2a5a548d72b9e938edaca2343b91ab0e1a71db24a77b2", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "industry-automotive": {
    id: "industry-automotive",
    alt: "Service adviser and customer reviewing a work order in an active repair shop.",
    label: "Automotive",
    usage: "illustrative",
    provenance: "generated",
    note: "Home card and auto-repair page. Generated editorial scene (owner review pending); not a photograph of a real business, customer or Liberty staff.",
    generation: { assetId: "05-automotive-workshop", sha256: "a3f2a6a8a72771fd25ddf73b675a676b20167519b01774e32daf098f71512e2c", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "industry-retail": {
    id: "industry-retail",
    alt: "Record-shop owner placing a record in its sleeve while a customer waits.",
    label: "Retail",
    usage: "illustrative",
    provenance: "generated",
    note: "Home card and retail page. Generated editorial scene (owner review pending); not a photograph of a real business, customer or Liberty staff.",
    generation: { assetId: "06-retail-record-shop", sha256: "2884c8ecb6f4eb310eb01ba891b9792d688925042d46627568e51d1bb6c42cbc", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "industry-field-services": {
    id: "industry-field-services",
    alt: "HVAC technician and homeowner reviewing a tablet outside a home.",
    label: "Contractors and field services",
    usage: "illustrative",
    provenance: "generated",
    note: "Construction page (field-service context). Generated editorial scene (owner review pending); not a photograph of a real business, customer or Liberty staff. Not on Home: contractors stay reachable through the industries hub.",
    generation: { assetId: "07-field-services", sha256: "107f6ae89d55fc97ee10c800a043d2930d8cb4fe34875a6fb2c7c8674b67b540", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "industry-ecommerce": {
    id: "industry-ecommerce",
    alt: "Small-business owner sealing a shipping carton at a packing bench.",
    label: "Ecommerce",
    usage: "illustrative",
    provenance: "generated",
    note: "Ecommerce page. Generated editorial scene (owner review pending); not a photograph of a real business, customer or Liberty staff.",
    generation: { assetId: "08-ecommerce-packing", sha256: "36cb78a57fe1b7cb7d5ba69afe6265ecd4cbc1d7a01dae9cbd708ed967075731", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "industry-professional-services": {
    id: "industry-professional-services",
    alt: "Architect and client discussing a plan in a small design studio.",
    label: "Professional services",
    usage: "illustrative",
    provenance: "generated",
    note: "Professional-services page. Generated editorial scene (owner review pending); not a photograph of a real business, customer or Liberty staff.",
    generation: { assetId: "09-professional-services", sha256: "033cf26c35aa0429f37e05fb33da0dfed5a0181dc0a2493e0b858f016668490a", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "process-review-hands": {
    id: "process-review-hands",
    alt: "Hands reviewing an illustrative checklist beside a calculator and closed laptop.",
    label: "Statement review process",
    usage: "illustrative",
    provenance: "generated",
    note: "Why Liberty process inset. Overhead process image with no faces; the pictured hands are not presented as Liberty staff and the checklist carries no figures.",
    generation: { assetId: "10-review-process", sha256: "ed4c4f415769dddd5e341c97174bca7db4c7ec20c2fc623d3ca035b06673d817", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "equipment-concept-terminal-upright": {
    id: "equipment-concept-terminal-upright",
    alt: "Upright illustrative white payment terminal with Liberty branding.",
    usage: "illustrative-equipment-only",
    provenance: "generated",
    note: "Countertop inset of the payment-setup illustration only. AI-redrawn illustrative hardware with the navy status panel level; it is not catalog or exact-model proof and does not imply included equipment or installed software.",
    generation: { assetId: "13-terminal-upright", sha256: "dd64a457b97347d5a9fa5684dbd6fcee23f8a4d31e7773407e81f574656bd74b", record: "docs/media/w-d-asset-pack-2026-11-10/generation-record.json", approval: "owner-review-pending" },
  },
  "product-clover-flex-3": {
    id: "product-clover-flex-3",
    alt: "Clover Flex 3 smart payment terminal",
    usage: "illustrative",
    provenance: "unverified",
    note: "Transparent product cut-out used on terminal pages. It shows the device model only; it is not a statement that the device is included, free or available to a given merchant (page copy carries the terms).",
  },
  "product-pax-a920": {
    id: "product-pax-a920",
    alt: "PAX A920 smart payment terminal",
    usage: "illustrative",
    provenance: "unverified",
    note: "Transparent product cut-out used on terminal pages. It shows the device model only; it is not a statement that the device is included, free or available to a given merchant (page copy carries the terms).",
  },
  "product-clover-mini-3": {
    id: "product-clover-mini-3",
    alt: "Clover Mini 3 countertop payment terminal",
    usage: "illustrative",
    provenance: "unverified",
    note: "Transparent product cut-out used on terminal pages. It shows the device model only; it is not a statement that the device is included, free or available to a given merchant (page copy carries the terms).",
  },
  "product-clover-station-duo": {
    id: "product-clover-station-duo",
    alt: "Clover Station Duo payment terminal with a customer-facing display",
    usage: "illustrative",
    provenance: "unverified",
    note: "Transparent product cut-out used on terminal pages. It shows the device model only; it is not a statement that the device is included, free or available to a given merchant (page copy carries the terms).",
  },
  "product-dejavoo-qd4": {
    id: "product-dejavoo-qd4",
    alt: "Dejavoo QD4 countertop payment terminal",
    usage: "illustrative",
    provenance: "unverified",
    note: "Transparent product cut-out used on terminal pages. It shows the device model only; it is not a statement that the device is included, free or available to a given merchant (page copy carries the terms).",
  },
  "product-swipesimple-b250": {
    id: "product-swipesimple-b250",
    alt: "SwipeSimple B250 countertop payment terminal",
    usage: "illustrative",
    provenance: "unverified",
    note: "Transparent product cut-out used on terminal pages. It shows the device model only; it is not a statement that the device is included, free or available to a given merchant (page copy carries the terms).",
  },
};

export interface PublicImageSource {
  /** Responsive srcset for one format. */
  srcSet: string;
  type: string;
}
export interface PublicImageVariant {
  name: string;
  width: number;
  height: number;
  /** Fallback `src` (JPEG, mid width) with intrinsic dimensions. */
  src: string;
  sources: PublicImageSource[];
  bytes: Record<"avif" | "webp" | "jpg", number>;
}

const MIME = { avif: "image/avif", webp: "image/webp", jpg: "image/jpeg" } as const;
const BASE = "/images/public/";

export function getPublicImage(id: PublicImageId, variantName: string): PublicImageVariant & { record: PublicImageRecord } {
  const entry = (manifest.entries as ManifestEntry[]).find((e) => e.id === id);
  const variant = entry?.variants.find((v) => v.name === variantName);
  if (!entry || !variant) throw new Error(`Unknown public image ${id}/${variantName}`);
  const byFormat = (format: ManifestFile["format"]) => variant.files.filter((f) => f.format === format).sort((a, b) => a.width - b.width);
  const srcSet = (format: ManifestFile["format"]) => byFormat(format).map((f) => `${BASE}${f.file} ${f.width}w`).join(", ");
  const jpgs = byFormat("jpg");
  const fallback = jpgs[Math.floor(jpgs.length / 2)] ?? jpgs[0];
  const total = (format: ManifestFile["format"]) => byFormat(format).reduce((n, f) => n + f.bytes, 0);
  return {
    record: PUBLIC_IMAGE_RECORDS[id],
    name: variant.name,
    width: fallback.width,
    height: fallback.height,
    src: `${BASE}${fallback.file}`,
    sources: [
      { srcSet: srcSet("avif"), type: MIME.avif },
      { srcSet: srcSet("webp"), type: MIME.webp },
      { srcSet: srcSet("jpg"), type: MIME.jpg },
    ],
    bytes: { avif: total("avif"), webp: total("webp"), jpg: total("jpg") },
  };
}

export interface PictureArgs {
  id: PublicImageId;
  /** Crop variant defined in scripts/build-public-images.ts (e.g. "card", "mobile"). */
  variant: string;
  /** `sizes` attribute describing the rendered width at each breakpoint. */
  sizes: string;
  /** Only the principal above-the-fold image of a page may be eager. */
  priority?: boolean;
  /** Art-direction sources (e.g. a wider desktop crop) tried before the default variant. */
  artDirection?: readonly { variant: string; media: string; sizes: string }[];
  /** Overrides the registry alt text; pass "" for a purely decorative repeat. */
  alt?: string;
}

export interface PictureSourceModel {
  media?: string;
  type: string;
  srcSet: string;
  sizes: string;
}

export interface PictureModel {
  id: PublicImageId;
  variant: string;
  sources: PictureSourceModel[];
  img: {
    src: string;
    srcSet: string;
    sizes: string;
    width: number;
    height: number;
    alt: string;
    loading: "eager" | "lazy";
    decoding: "async";
    fetchPriority?: "high";
  };
}

/**
 * Framework-free description of one responsive picture. The React component (PublicImage.tsx) and the
 * server-rendered pages (server/ssr/picture.ts) both render from this model, so the image id, srcset,
 * sizes, intrinsic dimensions, alt text and loading/priority attributes cannot differ between the first
 * document and the hydrated page. Art-direction sources come first, then AVIF and WebP for the default
 * crop, then the JPEG `img` fallback.
 */
export function describePicture({ id, variant, sizes, priority = false, artDirection = [], alt }: PictureArgs): PictureModel {
  const image = getPublicImage(id, variant);
  const [avif, webp, jpg] = image.sources;
  const sources: PictureSourceModel[] = artDirection.flatMap((art) =>
    getPublicImage(id, art.variant).sources.map((source) => ({ media: art.media, type: source.type, srcSet: source.srcSet, sizes: art.sizes })),
  );
  sources.push({ type: avif.type, srcSet: avif.srcSet, sizes }, { type: webp.type, srcSet: webp.srcSet, sizes });
  return {
    id,
    variant,
    sources,
    img: {
      src: image.src,
      srcSet: jpg.srcSet,
      sizes,
      width: image.width,
      height: image.height,
      alt: alt ?? image.record.alt,
      loading: priority ? "eager" : "lazy",
      decoding: "async",
      ...(priority ? { fetchPriority: "high" as const } : {}),
    },
  };
}
