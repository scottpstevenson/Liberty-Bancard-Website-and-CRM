import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PublicSection } from "@/components/public/PublicSection";
import { HOME_FOUNDER } from "@shared/public-home-content";

/**
 * Section 3: founder note. Text only: no approved portrait asset exists, and a stock or generated
 * face must not stand in for the founder. Add the approved photograph here when the owner supplies it.
 */
export function HomeFounder() {
  return (
    <PublicSection tone="canvas" labelledBy="home-founder-heading" data-testid="section-founder">
      <div className="max-w-3xl border-l-4 border-[hsl(var(--liberty-red))] pl-5 md:pl-8">
        <h2 id="home-founder-heading" className="public-h2 text-foreground" data-testid="text-founder-heading">
          {HOME_FOUNDER.heading}
        </h2>
        <p className="public-body public-secondary mt-3" data-testid="text-founder-body">{HOME_FOUNDER.body}</p>
        <Button asChild size="lg" className="public-cta public-cta--brand mt-5 sm:w-auto" data-testid="link-founder-talk">
          <Link href={HOME_FOUNDER.cta.href}>{HOME_FOUNDER.cta.label}</Link>
        </Button>
      </div>
    </PublicSection>
  );
}
