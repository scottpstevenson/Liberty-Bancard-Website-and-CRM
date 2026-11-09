import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { HOME_STARTING_POINTS } from "@shared/public-home-content";
import { trackStatementUploadCtaClick } from "@/lib/tracking";

/**
 * Section 5: contextual starting points for a specific decision (a statement review, a terminal).
 * These are the only offer entrances on Home besides the review section. Body and terms notes come
 * from the shared claim records through shared/public-home-content.ts; nothing promotional is
 * written here.
 */
export function HomeStartingPoints() {
  return (
    <PublicSection tone="light" data-home-section="starting-points" labelledBy="home-starting-points-heading" data-testid="section-starting-points">
      <PublicSectionHeader id="home-starting-points-heading" title={HOME_STARTING_POINTS.heading} titleTestId="text-starting-points-heading" />
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6" data-testid="grid-starting-points">
        {HOME_STARTING_POINTS.cards.map((card) => (
          <li key={card.id} className="public-card public-card--brand flex flex-col p-5 md:p-6" data-testid={`card-starting-point-${card.id}`}>
            <h3 className="public-h3 text-foreground">{card.title}</h3>
            <p className="public-body public-secondary mt-2 flex-1">{card.body}</p>
            <Button
              asChild
              size="lg"
              className="public-cta public-cta--brand mt-4 self-start"
              data-testid={`link-starting-point-${card.id}`}
              onClick={card.id === "review" ? () => trackStatementUploadCtaClick({ page: "/", ctaLabel: card.ctaLabel, ctaLocation: "starting-points" }) : undefined}
            >
              <Link href={card.href}>{card.ctaLabel}</Link>
            </Button>
            <p className="public-caption public-secondary mt-3">{card.note}</p>
          </li>
        ))}
      </ul>
    </PublicSection>
  );
}
