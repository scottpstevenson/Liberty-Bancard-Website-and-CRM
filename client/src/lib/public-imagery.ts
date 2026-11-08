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
 * Provenance policy. These originals were committed to the repository before this
 * registry existed and none carries a licence record. They are therefore used only
 * as `illustrative` imagery (never as a named customer, a quoted merchant, or a
 * claim about a real business) and every one is marked `provenance: "unverified"`.
 * Replacing an image with a licensed or commissioned photo means adding the source
 * to build-public-images.ts and updating its record here; no page code changes.
 *
 * Excluded on purpose (see the mobile audit's imagery table): hero-merchant.jpg
 * (grocery aisle with foreign-language price tags), merchant-owner.jpg,
 * vertical-auto.jpg, vertical-retail.jpg (shopping carts), vertical-home-services.jpg
 * (restroom fixtures) and case-medical.jpg. They remain on disk for pages that
 * already use them.
 */
export type PublicImageId =
  | "hero-terminal-tap"
  | "industry-restaurant"
  | "industry-healthcare"
  | "industry-automotive"
  | "industry-retail"
  | "industry-home-services"
  | "how-statement-review"
  | "product-clover-flex-3"
  | "product-pax-a920"
  | "product-clover-mini-3"
  | "product-clover-station-duo"
  | "product-dejavoo-qd4"
  | "product-swipesimple-b250";

export type ImageProvenance = "unverified";

interface ManifestFile { format: "avif" | "webp" | "jpg"; file: string; width: number; height: number; bytes: number }
interface ManifestVariant { name: string; width: number; height: number; files: ManifestFile[] }
interface ManifestEntry { id: string; source: string; sourceSha256: string; variants: ManifestVariant[] }

export interface PublicImageRecord {
  id: PublicImageId;
  alt: string;
  /** Short visible label for image-backed cards. */
  label?: string;
  usage: "illustrative";
  provenance: ImageProvenance;
  /** What the picture shows and why it is allowed in that slot. */
  note: string;
}

export const PUBLIC_IMAGE_RECORDS: Record<PublicImageId, PublicImageRecord> = {
  "hero-terminal-tap": {
    id: "hero-terminal-tap",
    alt: "A customer taps a card on a countertop payment terminal that shows an approved transaction.",
    usage: "illustrative",
    provenance: "unverified",
    note: "Rendered payment moment on a Liberty-branded handheld terminal. Shows the product's approved screen, not a named merchant.",
  },
  "industry-restaurant": {
    id: "industry-restaurant",
    alt: "A restaurant kitchen pass with steam and staff at work.",
    label: "Restaurants",
    usage: "illustrative",
    provenance: "unverified",
    note: "Working kitchen counter. Crop keeps the cook and pass; no readable signage or brand.",
  },
  "industry-healthcare": {
    id: "industry-healthcare",
    alt: "A clinic front-desk worktop with a laptop, stethoscope and paperwork.",
    label: "Medical, dental and medspa",
    usage: "illustrative",
    provenance: "unverified",
    note: "Front-desk billing context; crop drops the empty left third. No faces, no patient data.",
  },
  "industry-automotive": {
    id: "industry-automotive",
    alt: "A mechanic working underneath a classic car in a garage.",
    label: "Automotive",
    usage: "illustrative",
    provenance: "unverified",
    note: "Black-and-white repair-shop scene. Audit rates automotive imagery weak; kept to small card size only.",
  },
  "industry-retail": {
    id: "industry-retail",
    alt: "Handbags and accessories on the shelves of a boutique.",
    label: "Retail",
    usage: "illustrative",
    provenance: "unverified",
    note: "Boutique shelving. No readable brand marks at card size.",
  },
  "industry-home-services": {
    id: "industry-home-services",
    alt: "A technician repairing a phone at a workbench with a magnifier.",
    label: "Home and field services",
    usage: "illustrative",
    provenance: "unverified",
    note: "Repair bench. Closest committed image to on-site service work.",
  },
  "how-statement-review": {
    id: "how-statement-review",
    alt: "Printed statements with charts beside a laptop and a cup of coffee.",
    usage: "illustrative",
    provenance: "unverified",
    note: "Desk with printed charts. Generic by design: it does not show a real customer's statement.",
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
