import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicImage } from "@/components/public/PublicImage";
import { HOME_HERO, HOME_HERO_IMAGE } from "@shared/public-home-content";

/**
 * Section 1: evergreen hero. Eyebrow, one headline (first thought navy, second blue), one sentence on
 * what Liberty helps with, and two full-width actions on phones: a free statement review and the general
 * payment-setup inquiry. The merchant photo follows the actions on phones (4:3 crop) and is inset at
 * roughly half the hero width from lg (full 3:2 frame). It is the page's only eager image and its frame
 * owns the aspect ratio at each breakpoint, so nothing shifts when it loads. The two helper lines under
 * the actions appear from md only. Hero copy and CTAs are never animated from opacity 0 (they are the LCP
 * candidate). Wording lives in shared/public-home-content.ts and is shared with the server-rendered Home.
 */
export function HomeHero() {
  return (
    <section className="marketing-surface relative border-b border-border bg-background" data-home-section="hero" data-testid="section-hero">
      <div className="public-container pt-6 pb-8 lg:py-14">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-center lg:gap-x-14">
          <div>
            <p className="public-eyebrow public-eyebrow--brand mb-3" data-testid="text-hero-badge">{HOME_HERO.eyebrow}</p>
            <h1 className="public-h1 mb-4 max-w-[20ch] lg:max-w-[16ch]" data-testid="text-hero-heading">
              <span className="text-[hsl(var(--liberty-navy))]">{HOME_HERO.headingFirst}</span>{" "}
              <span className="text-[hsl(var(--public-blue-ink))]">{HOME_HERO.headingSecond}</span>
            </h1>
            <p className="public-body public-secondary mb-6 max-w-xl lg:text-lg" data-testid="text-hero-subheadline">
              {HOME_HERO.body}
            </p>
            <div className="flex flex-col gap-3 sm:max-w-md lg:max-w-none lg:flex-row" data-testid="hero-cta-block">
              <Button asChild size="lg" className="public-cta public-cta--brand w-full gap-2 lg:w-auto" data-testid="link-hero-explore">
                <a href={HOME_HERO.primary.href}>
                  {HOME_HERO.primary.label}
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="public-cta w-full gap-2 border-border lg:w-auto" data-testid="link-hero-talk">
                <Link href={HOME_HERO.secondary.href}>{HOME_HERO.secondary.label}</Link>
              </Button>
            </div>
            <p className="public-small mt-4 hidden font-semibold text-foreground md:block" data-testid="text-hero-helper">
              {HOME_HERO.desktopHelper}
            </p>
            <p className="public-caption public-secondary mt-1 hidden max-w-md md:block" data-testid="text-hero-qualification">
              {HOME_HERO.desktopQualification}
            </p>
          </div>

          <div data-testid="hero-visual">
            <div className="public-frame public-frame--fill aspect-[4/3] sm:mx-auto sm:max-w-xl lg:aspect-[3/2] lg:max-w-none">
              <PublicImage
                id={HOME_HERO_IMAGE.id}
                variant={HOME_HERO_IMAGE.mobile.variant}
                sizes={HOME_HERO_IMAGE.mobile.sizes}
                artDirection={[HOME_HERO_IMAGE.desktop]}
                priority
                data-testid="img-hero-photo"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
