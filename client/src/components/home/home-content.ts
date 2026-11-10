import { PUBLIC_IMAGE_RECORDS, type PublicImageId } from "@/lib/public-imagery";
import { HOME_INDUSTRIES_SECTION } from "@shared/public-home-content";

/**
 * Home industry entries with their image ids checked against the public imagery registry. Wording (title,
 * best-for line, order) and the image assignment live in shared/public-home-content.ts so the
 * server-rendered Home lists the same entries with the same photographs; this module only proves that
 * every assigned id is a registered image.
 */
export interface HomeIndustry {
  slug: string;
  image: PublicImageId;
  title: string;
  bestFor: string;
}

export const HOME_INDUSTRIES: HomeIndustry[] = HOME_INDUSTRIES_SECTION.entries.map((entry) => {
  if (!(entry.image in PUBLIC_IMAGE_RECORDS)) throw new Error(`Home industry ${entry.slug} names unregistered image ${entry.image}`);
  return { ...entry, image: entry.image as PublicImageId };
});
