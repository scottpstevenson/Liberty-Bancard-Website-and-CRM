import type { PublicImageId } from "@/lib/public-imagery";

import { HOME_INDUSTRIES_SECTION } from "@shared/public-home-content";

/**
 * Photograph for each Home industry entry. Wording (title, best-for line, order) lives in
 * shared/public-home-content.ts so the server-rendered Home lists the same entries; only the image
 * assignment is client-side.
 */
const HOME_INDUSTRY_IMAGES: Record<string, PublicImageId | null> = {
  "restaurant-payment-processing": "industry-restaurant",
  "healthcare-payment-processing": "industry-healthcare",
  "auto-repair-payment-processing": "industry-automotive",
  "retail-payment-processing": "industry-retail",
  // No registered photograph depicts on-site service work (see public-imagery.ts); the card uses a native icon tile.
  "construction-payment-processing": null,
};

export interface HomeIndustry {
  slug: string;
  image: PublicImageId | null;
  title: string;
  bestFor: string;
}

export const HOME_INDUSTRIES: HomeIndustry[] = HOME_INDUSTRIES_SECTION.entries.map((entry) => {
  if (!(entry.slug in HOME_INDUSTRY_IMAGES)) throw new Error(`Home industry ${entry.slug} has no image assignment`);
  return { ...entry, image: HOME_INDUSTRY_IMAGES[entry.slug] };
});
