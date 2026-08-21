import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Upload, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { CALENDAR_URL } from "@/lib/constants";
import { trackStatementUploadCtaClick, trackBookingCtaClick } from "@/lib/tracking";
import { buildAttributedBookingUrl } from "@/lib/utm";

export type PublicCTAVariant = "primary" | "secondary" | "both";

/**
 * "default" → use on light/card backgrounds (primary = filled navy, secondary = outline navy)
 * "inverse" → use on dark/primary-colour backgrounds (primary = white fill, secondary = white outline)
 */
export type PublicCTAScheme = "default" | "inverse";

export interface PublicCTAProps {
  /**
   * "primary"   → Upload My Statement
   * "secondary" → Book a Free Call
   * "both"      → render both side-by-side
   */
  variant?: PublicCTAVariant;
  /**
   * Visual scheme:
   *   "default" (light backgrounds) — primary gets default navy fill
   *   "inverse" (dark/primary backgrounds) — primary gets secondary variant (white fill)
   *   so it contrasts against the dark section background.
   */
  scheme?: PublicCTAScheme;
  /** Override the primary button label */
  primaryLabel?: string;
  /** Override the secondary button label */
  secondaryLabel?: string;
  /** Upload destination (default /upload-statement) */
  uploadHref?: string;
  /** Tracking metadata passed to analytics helpers */
  ctaLocation?: string;
  className?: string;
  size?: "sm" | "default" | "lg";
}

/**
 * Standardised conversion CTA component.
 *
 * Two canonical actions:
 *   Primary   → Upload My Statement  →  /upload-statement  (filled, navy)
 *   Secondary → Book a Free Call     →  calendar booking link (outline, navy)
 *
 * Use `variant="both"` to show both side-by-side.
 */
export function PublicCTA({
  variant = "both",
  scheme = "default",
  primaryLabel = "Upload My Statement",
  secondaryLabel = "Book a Free Call",
  uploadHref = "/upload-statement",
  ctaLocation = "page",
  className,
  size = "default",
}: PublicCTAProps) {
  const showPrimary = variant === "primary" || variant === "both";
  const showSecondary = variant === "secondary" || variant === "both";

  // On dark/primary-colour backgrounds ("inverse" scheme) the default filled-navy
  // button is invisible — use the "secondary" variant (white fill, dark text) instead.
  // The outline button gets white border and white text to contrast the dark bg.
  const primaryVariant = scheme === "inverse" ? "secondary" : "default";
  const secondaryBtnClass =
    scheme === "inverse"
      ? "gap-2 w-full sm:w-auto border-white/40 text-white hover:bg-white/10 hover:text-white"
      : "gap-2 w-full sm:w-auto border-border";

  return (
    <div
      className={cn("flex flex-col sm:flex-row gap-3 flex-wrap", className)}
      data-testid="public-cta-group"
    >
      {showPrimary && (
        <Button
          asChild
          size={size}
          variant={primaryVariant}
          className="gap-2 w-full sm:w-auto"
          data-testid="public-cta-primary"
          onClick={() =>
            trackStatementUploadCtaClick({
              ctaLabel: primaryLabel,
              ctaLocation,
            })
          }
        >
          <Link href={uploadHref}>
            <Upload className="w-4 h-4 shrink-0" />
            {primaryLabel}
          </Link>
        </Button>
      )}

      {showSecondary && (
        <a
          href={buildAttributedBookingUrl(CALENDAR_URL, { ctaLocation })}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="public-cta-secondary"
          onClick={() => trackBookingCtaClick({ ctaLabel: secondaryLabel, ctaLocation })}
        >
          <Button
            size={size}
            variant="outline"
            className={secondaryBtnClass}
          >
            <Calendar className="w-4 h-4 shrink-0" />
            {secondaryLabel}
          </Button>
        </a>
      )}
    </div>
  );
}
