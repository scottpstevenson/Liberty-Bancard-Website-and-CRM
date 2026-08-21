import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PublicCTADef {
  label: string;
  href: string;
  external?: boolean;
  onClick?: () => void;
  icon?: React.ReactNode;
}

export interface PublicHeroProps {
  /** Large headline — supports JSX for coloured spans */
  headline: React.ReactNode;
  /** Subheadline text */
  subheadline: React.ReactNode;
  /** Primary CTA button (filled, navy) */
  primaryCta: PublicCTADef;
  /** Secondary CTA button (outline) */
  secondaryCta?: PublicCTADef;
  /**
   * Additional ghost/text links rendered after the primary CTAs.
   * Use for "already have an account?" / portal login links that must
   * remain above the fold but shouldn't compete visually with the main CTAs.
   */
  tertiaryLinks?: PublicCTADef[];
  /** Small trust-badge strings rendered in a grey row beneath CTAs */
  trustBadges?: string[];
  /** Optional right-column content (e.g. screenshot or mock card) */
  rightColumn?: React.ReactNode;
  /** Extra badge/label above the headline */
  badge?: React.ReactNode;
  /** Fine-print / microcopy below the CTA row */
  microcopy?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Shared hero component for all public marketing pages.
 *
 * Layout:
 *   - Single-column on mobile/tablet
 *   - Two-column (1.05fr / 0.95fr) on lg when rightColumn is provided
 *   - Headline scales text-3xl → text-5xl
 *   - CTAs in flex row, wrapping to column at sm
 *   - Trust badges as a small grey row beneath CTAs
 */
export function PublicHero({
  headline,
  subheadline,
  primaryCta,
  secondaryCta,
  tertiaryLinks,
  trustBadges,
  rightColumn,
  badge,
  microcopy,
  className,
  "data-testid": testId = "section-hero",
}: PublicHeroProps) {
  const hasRightCol = Boolean(rightColumn);

  return (
    <section
      className={cn(
        "marketing-surface relative overflow-hidden bg-background border-b border-border",
        className
      )}
      data-testid={testId}
    >
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12 lg:py-24">
        <div
          className={cn(
            "grid grid-cols-1 gap-10 items-center",
            hasRightCol && "lg:grid-cols-[1.05fr_0.95fr] lg:gap-16"
          )}
        >
          {/* Left column — message + CTAs */}
          <div className="pt-2 md:pt-5">
            {badge && (
              <div className="si-load si-load-1 mb-4" data-testid="hero-badge">
                {badge}
              </div>
            )}

            <h1
              className="si-load si-load-2 text-3xl sm:text-4xl md:text-5xl leading-tight font-bold text-foreground mb-4"
              data-testid="text-hero-heading"
            >
              {headline}
            </h1>

            <p
              className="si-load si-load-3 text-base sm:text-lg text-muted-foreground leading-relaxed mb-6 max-w-xl"
              data-testid="text-hero-subheadline"
            >
              {subheadline}
            </p>

            {/* CTA buttons */}
            <div
              className="si-load si-load-4 flex flex-col sm:flex-row gap-3 flex-wrap"
              data-testid="hero-cta-block"
            >
              <CTAButton def={primaryCta} variant="primary" />
              {secondaryCta && <CTAButton def={secondaryCta} variant="secondary" />}
              {tertiaryLinks && tertiaryLinks.map((link, i) => (
                <CTAButton key={i} def={link} variant="tertiary" />
              ))}
            </div>

            {microcopy && (
              <div className="si-load si-load-4 mt-2" data-testid="hero-microcopy">
                {microcopy}
              </div>
            )}

            {/* Trust badges */}
            {trustBadges && trustBadges.length > 0 && (
              <div
                className="si-load si-load-5 flex flex-wrap items-center gap-x-4 gap-y-2 mt-6 pt-5 border-t border-border"
                data-testid="hero-trust-badges"
              >
                {trustBadges.map((badge, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                  >
                    <BadgeCheck className="w-3.5 h-3.5 text-accent shrink-0" />
                    {badge}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right column (optional) */}
          {hasRightCol && (
            <div
              className="relative hidden lg:flex items-center justify-center lg:justify-end"
              data-testid="hero-visual"
            >
              {rightColumn}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CTAButton({ def, variant }: { def: PublicCTADef; variant: "primary" | "secondary" | "tertiary" }) {
  const cls = "gap-2 w-full sm:w-auto h-12 sm:h-auto text-base sm:text-sm font-bold";

  let buttonVariant: "default" | "outline" | "ghost";
  if (variant === "primary") buttonVariant = "default";
  else if (variant === "tertiary") buttonVariant = "ghost";
  else buttonVariant = "outline";

  // Fragment anchors (#section-id) and external links MUST use a native <a> element.
  // Wouter's <Link> intercepts all clicks via history.pushState, preventing native
  // browser scroll-to-anchor behaviour. onClick must live on the wrapper only to
  // avoid firing twice (once on the anchor, once bubbling up from the Button).
  const isFragment = def.href.startsWith("#");
  const useNativeAnchor = isFragment || def.external;

  const inner = (
    <Button
      size="lg"
      variant={buttonVariant}
      className={cn(cls, variant === "secondary" && "border-border")}
      // onClick goes on the outer wrapper for native-anchor CTAs to prevent double-fire.
      onClick={useNativeAnchor ? undefined : def.onClick}
    >
      {def.icon}
      {def.label}
    </Button>
  );

  if (useNativeAnchor) {
    return (
      <a
        href={def.href}
        target={def.external ? "_blank" : undefined}
        rel={def.external ? "noopener noreferrer" : undefined}
        data-testid={`link-hero-${variant}`}
        onClick={def.onClick}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link href={def.href} data-testid={`link-hero-${variant}`} onClick={def.onClick}>
      {inner}
    </Link>
  );
}
