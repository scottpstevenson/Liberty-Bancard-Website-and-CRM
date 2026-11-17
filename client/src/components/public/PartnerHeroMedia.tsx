import type { CSSProperties } from "react";
import { PublicImage } from "@/components/public/PublicImage";
import type { PublicImageId } from "@/lib/public-imagery";
import { PARTNER_MEDIA_CAPTION, partnerMediaFor, partnerMediaObjectPosition, type PartnerMediaRole } from "@shared/partner-page-media";

interface PartnerMediaProps {
  route: string;
  role?: PartnerMediaRole;
}

/**
 * The picture of one partnership route (hero or body image), cut and described by shared/partner-page-media.ts and
 * rendered through the shared PublicImage pipeline (AVIF, WebP, JPEG fallback, srcset, explicit dimensions). Only the
 * hero image is eager; body images below the first view are lazy. The server document renders the same picture model
 * (server/ssr/partners.ts), so the document and the hydrated page agree on image id, crop, alt text and priority.
 */
export function PartnerMedia({ route, role = "hero" }: PartnerMediaProps) {
  const entry = partnerMediaFor(route, role);
  const style = { "--partner-focal": partnerMediaObjectPosition(entry) } as CSSProperties;
  return (
    <figure className={`partner-media partner-media--${role}`} data-testid={`partner-media-${role}`} data-partner-media-route={route}>
      <div className="public-frame public-frame--fill" style={style}>
        <PublicImage
          id={entry.imageId as PublicImageId}
          variant={entry.variant}
          sizes={entry.sizes}
          alt={entry.alt}
          priority={entry.priority}
          data-testid={`img-partner-${role}`}
        />
      </div>
      <figcaption className="partner-media-caption public-caption public-secondary">{PARTNER_MEDIA_CAPTION}</figcaption>
    </figure>
  );
}
