import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicImage } from "@/components/public/PublicImage";
import { HOME_HERO } from "@shared/public-home-content";

/**
 * Section 1: evergreen hero. One headline, one sentence on what Liberty helps with, and two actions:
 * explore the solution entry points on this page, or talk to Liberty. The payment-moment photo follows
 * the actions on phones and takes the right ~45% from lg. The photo is the page's only eager image and
 * the frame owns its aspect ratio at each breakpoint, so nothing shifts when it loads. Hero copy and
 * CTAs are never animated from opacity 0 (they are the LCP candidate). Wording lives in
 * shared/public-home-content.ts and is shared with the server-rendered Home.
 */
export function HomeHero() {
  return (
    <section className="marketing-surface relative border-b border-border bg-background" data-home-section="hero" data-testid="section-hero">
      <div className="public-container pt-6 pb-8 lg:py-16">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[11fr_9fr] lg:items-center lg:gap-x-14">
          <div>
            <p className="public-eyebrow public-eyebrow--brand mb-3" data-testid="text-hero-badge">{HOME_HERO.eyebrow}</p>
            <h1 className="public-h1 mb-4 max-w-[20ch] text-foreground" data-testid="text-hero-heading">
              {HOME_HERO.heading}
            </h1>
            <p className="public-body public-secondary mb-6 max-w-xl lg:text-lg" data-testid="text-hero-subheadline">
              {HOME_HERO.body}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row" data-testid="hero-cta-block">
              <Button asChild size="lg" className="public-cta public-cta--brand gap-2 sm:w-auto" data-testid="link-hero-explore">
                <a href={HOME_HERO.primary.href}>
                  {HOME_HERO.primary.label}
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="public-cta gap-2 border-border sm:w-auto" data-testid="link-hero-talk">
                <Link href={HOME_HERO.secondary.href}>{HOME_HERO.secondary.label}</Link>
              </Button>
            </div>
            <p className="public-caption public-secondary mt-4 max-w-md" data-testid="text-hero-compliance">
              {HOME_HERO.compliance}
            </p>
          </div>

          <div data-testid="hero-visual">
            <div className="public-frame public-frame--fill aspect-[4/3] lg:aspect-[1060/896]">
              <PublicImage
                id="hero-terminal-tap"
                variant="mobile"
                sizes="100vw"
                artDirection={[{ variant: "desktop", media: "(min-width: 1024px)", sizes: "(min-width: 1200px) 520px, 42vw" }]}
                priority
                data-testid="img-hero-terminal"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
