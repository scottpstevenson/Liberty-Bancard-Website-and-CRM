import { cn } from "@/lib/utils";
import { getPublicImage, type PublicImageId } from "@/lib/public-imagery";

export interface PublicImageProps {
  id: PublicImageId;
  /** Crop variant defined in scripts/build-public-images.ts (e.g. "card", "mobile"). */
  variant: string;
  /** `sizes` attribute describing the rendered width at each breakpoint. */
  sizes: string;
  /** Only the principal above-the-fold image of a page may be eager. */
  priority?: boolean;
  /** Art-direction sources (e.g. a wider desktop crop) tried before the default variant. */
  artDirection?: { variant: string; media: string; sizes: string }[];
  /** Overrides the registry alt text; pass "" for a purely decorative repeat. */
  alt?: string;
  className?: string;
  imgClassName?: string;
  "data-testid"?: string;
}

/**
 * Responsive, art-directed public image: AVIF and WebP sources with a JPEG fallback,
 * explicit intrinsic width/height (so the frame reserves its space before the file
 * arrives and the page cannot shift), lazy loading by default, and `fetchpriority`
 * high only for the one image marked `priority`. Inside a `.public-frame--fill` frame
 * the frame owns the aspect ratio, which is how art-directed crops stay shift-free.
 */
export function PublicImage({ id, variant, sizes, priority = false, artDirection = [], alt, className, imgClassName, "data-testid": testId }: PublicImageProps) {
  const image = getPublicImage(id, variant);
  const [avif, webp, jpg] = image.sources;
  return (
    <picture className={className} data-testid={testId}>
      {artDirection.flatMap((art) => {
        const [aAvif, aWebp, aJpg] = getPublicImage(id, art.variant).sources;
        return [aAvif, aWebp, aJpg].map((source) => (
          <source key={`${art.variant}-${source.type}`} media={art.media} type={source.type} srcSet={source.srcSet} sizes={art.sizes} />
        ));
      })}
      <source type={avif.type} srcSet={avif.srcSet} sizes={sizes} />
      <source type={webp.type} srcSet={webp.srcSet} sizes={sizes} />
      <img
        src={image.src}
        srcSet={jpg.srcSet}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={alt ?? image.record.alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : {})}
        className={cn("h-auto w-full", imgClassName)}
      />
    </picture>
  );
}
