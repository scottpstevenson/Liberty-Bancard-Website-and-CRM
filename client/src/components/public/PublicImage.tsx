import { cn } from "@/lib/utils";
import { describePicture, type PictureArgs } from "@/lib/public-imagery";

export interface PublicImageProps extends PictureArgs {
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
 * React 18 does not know the camel-case `fetchPriority` prop (it warns in development and emits a
 * mixed-case attribute), so the lowercase HTML attribute is passed through, which is what the server emits.
 * The markup is described once by describePicture() and rendered identically by the
 * server (server/ssr/picture.ts).
 */
export function PublicImage({ className, imgClassName, "data-testid": testId, ...args }: PublicImageProps) {
  const model = describePicture(args);
  const { img } = model;
  return (
    <picture className={className} data-testid={testId}>
      {model.sources.map((source) => (
        <source key={`${source.media ?? "default"}-${source.type}`} media={source.media} type={source.type} srcSet={source.srcSet} sizes={source.sizes} />
      ))}
      <img
        src={img.src}
        srcSet={img.srcSet}
        sizes={img.sizes}
        width={img.width}
        height={img.height}
        alt={img.alt}
        loading={img.loading}
        decoding={img.decoding}
        {...(img.fetchPriority ? { fetchpriority: img.fetchPriority } : {})}
        className={cn("h-auto w-full", imgClassName)}
      />
    </picture>
  );
}
