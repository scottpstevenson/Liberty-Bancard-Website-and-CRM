/**
 * Partnership-page imagery: the one record of which cleared image each partnership route shows, how it is cropped, what
 * its alt text says and which one image per page is the priority (LCP) image.
 *
 * Read by the derivative pipeline (scripts/build-public-images.ts cuts the `crop` of every entry), the React pages
 * (components/public/PartnerHeroMedia.tsx), the server documents (server/ssr/partners.ts) and the asset-manifest test
 * (scripts/test-partner-page-media.ts), so the picture a crawler or a slow connection receives is the picture the page
 * shows after it loads.
 *
 * Provenance. Every source below is a W-D generated editorial scene already registered in
 * client/src/lib/public-imagery.ts (provenance "generated", approval "owner-review-pending"; master, prompt and checksum in
 * docs/media/w-d-asset-pack-2026-11-10). They are synthetic illustrations, not photographs of real people, customers,
 * partners or Liberty staff, and the visible caption says so. No image is purchased, hot-linked or newly generated here.
 *
 * Fit. `scene` means the picture shows the subject the route wants. `approximate` means the cleared set has no picture of
 * that exact scene, the closest cleared scene is used, and `gap` names the picture that would replace it. An approximate
 * picture is never described as the profession it stands near.
 *
 * No database or server imports: the client bundle imports this file.
 */
import { PARTNER_ROUTES } from "./partner-public-content";

export type PartnerMediaRole = "hero" | "body";

/** Source-pixel rectangle cut from a 1536x1024 W-D master. */
export interface PartnerMediaCrop { left: number; top: number; width: number; height: number }

export interface PartnerMediaEntry {
  route: string;
  role: PartnerMediaRole;
  /** Id in client/src/lib/public-imagery.ts (PublicImageId). */
  imageId: string;
  /** Derivative variant name cut by scripts/build-public-images.ts from `crop`. */
  variant: "partner-hero" | "partner-body";
  crop: PartnerMediaCrop;
  /** Focal point in percent of the cropped frame; becomes object-position so a narrower frame keeps the subject. */
  focal: { x: number; y: number };
  widths: readonly number[];
  alt: string;
  sizes: string;
  priority: boolean;
  fit: "scene" | "approximate";
  /** Only for approximate fits: the exact picture that is missing from the cleared set. */
  gap?: string;
  /** What the picture is, in one line, for the asset manifest. */
  subject: string;
}

export const PARTNER_MEDIA_CAPTION = "Illustrative scene. Not a Liberty customer, partner or employee.";

/** 1280 x 853 is a 3:2 cut of the 1536 x 1024 master; each page takes a different window of its own source. */
const HERO_W = 1280;
const HERO_H = 853;
/** 1365 x 1024 is the 4:3 cut used for body images. */
const BODY_W = 1365;
const BODY_H = 1024;

const HERO_SIZES = "(min-width: 1024px) 540px, (min-width: 640px) 480px, calc(100vw - 32px)";
const BODY_SIZES = "(min-width: 1024px) 440px, (min-width: 640px) 480px, calc(100vw - 32px)";
const HERO_WIDTHS = [480, 720, 960] as const;
const BODY_WIDTHS = [320, 480, 640] as const;

function hero(
  route: string,
  imageId: string,
  left: number,
  top: number,
  focal: { x: number; y: number },
  alt: string,
  subject: string,
  fit: "scene" | "approximate" = "scene",
  gap?: string,
): PartnerMediaEntry {
  return { route, role: "hero", imageId, variant: "partner-hero", crop: { left, top, width: HERO_W, height: HERO_H }, focal, widths: HERO_WIDTHS, alt, sizes: HERO_SIZES, priority: true, fit, ...(gap ? { gap } : {}), subject };
}

function body(
  route: string,
  imageId: string,
  left: number,
  alt: string,
  subject: string,
  fit: "scene" | "approximate" = "scene",
  gap?: string,
): PartnerMediaEntry {
  return { route, role: "body", imageId, variant: "partner-body", crop: { left, top: 0, width: BODY_W, height: BODY_H }, focal: { x: 50, y: 50 }, widths: BODY_WIDTHS, alt, sizes: BODY_SIZES, priority: false, fit, ...(gap ? { gap } : {}), subject };
}

export const PARTNER_MEDIA: readonly PartnerMediaEntry[] = [
  hero(PARTNER_ROUTES.hub, "industry-professional-services", 205, 60, { x: 50, y: 30 },
    "Two adults reviewing building plans together at a table in a small design studio.",
    "Professional conversation with a client in a small-business setting"),
  hero(PARTNER_ROUTES.referral, "industry-med-spa", 128, 20, { x: 50, y: 32 },
    "Two women talking over an open booklet at a consultation table.",
    "Two adults discussing a document, the shape of a warm introduction"),
  hero(PARTNER_ROUTES.salesAgent, "industry-automotive", 100, 60, { x: 50, y: 35 },
    "A mechanic showing a customer a work order on a clipboard in a busy repair shop.",
    "A shop owner going over a work order with a customer in the merchant's own workplace"),
  hero(PARTNER_ROUTES.cpa, "process-review-hands", 128, 86, { x: 50, y: 50 },
    "Hands filling in a checklist beside a calculator and a closed laptop on a desk.",
    "Overhead desk view of a record review, no faces",
    "approximate", "A cleared photograph of an accountant and a business client reviewing ordinary business figures."),
  hero(PARTNER_ROUTES.bookkeeper, "industry-dental", 150, 30, { x: 50, y: 35 },
    "A clinic front-desk coordinator going through a folder with a visitor at the reception counter.",
    "Office staff and a visitor going through a folder of records",
    "approximate", "A cleared photograph of a bookkeeper and a business owner reviewing operational records."),
  hero(PARTNER_ROUTES.insurance, "industry-field-services", 100, 20, { x: 50, y: 30 },
    "A service technician showing a tablet to a homeowner outside a house.",
    "A professional advising a client on site with a tablet",
    "approximate", "A cleared photograph of an insurance professional advising a business owner in a business setting."),
  hero(PARTNER_ROUTES.affiliate, "industry-retail", 128, 20, { x: 50, y: 30 },
    "A record-shop owner and a customer at the shop counter.",
    "Small-business owner and a customer at the counter, the relationship an affiliate refers"),

  body(PARTNER_ROUTES.hub, "industry-restaurant", 85,
    "A restaurant server and a seated customer going over an order in a dining room.",
    "The kind of independent business a partner introduces"),
  body(PARTNER_ROUTES.cpa, "industry-ecommerce", 85,
    "A small-business owner taping a shipping carton at a packing bench.",
    "A small-business client at work"),
  body(PARTNER_ROUTES.bookkeeper, "industry-retail", 85,
    "A record-shop owner sliding a record into a sleeve while a customer waits at the counter.",
    "A small retail client at work"),
  body(PARTNER_ROUTES.insurance, "industry-professional-services", 85,
    "Two professionals reviewing building plans together in a small design studio.",
    "Two professionals going over documents in a small business"),
];

export function partnerMediaFor(route: string, role: PartnerMediaRole): PartnerMediaEntry {
  const entry = PARTNER_MEDIA.find((m) => m.route === route && m.role === role);
  if (!entry) throw new Error(`No ${role} image is registered for ${route}`);
  return entry;
}

export function hasPartnerMedia(route: string, role: PartnerMediaRole): boolean {
  return PARTNER_MEDIA.some((m) => m.route === route && m.role === role);
}

/** `object-position` for the frame: the focal point keeps the subject when the frame is narrower than the 3:2 cut. */
export function partnerMediaObjectPosition(entry: PartnerMediaEntry): string {
  return `${entry.focal.x}% ${entry.focal.y}%`;
}
