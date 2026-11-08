import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { HOME_SOLUTIONS, HOME_SOLUTIONS_ANCHOR } from "@shared/public-home-content";
import { isHomeAnchor } from "@shared/public-navigation";

/**
 * Section 2 (#solutions): three starting points, one per way a merchant begins. Stacked on phones, three
 * columns from md; no carousel. Entries that point at a section of this page use a native anchor so the
 * browser scrolls to it; the rest are client-side links to existing pages.
 */
export function HomeSolutions() {
  return (
    <PublicSection tone="light" id={HOME_SOLUTIONS_ANCHOR} labelledBy="home-solutions-heading" data-testid="section-solutions">
      <PublicSectionHeader id="home-solutions-heading" title={HOME_SOLUTIONS.heading} titleTestId="text-solutions-heading" />
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6" data-testid="grid-solutions">
        {HOME_SOLUTIONS.cards.map((card) => {
          const body = (
            <>
              <h3 className="public-h3 text-foreground">{card.title}</h3>
              <p className="public-body public-secondary mt-2 flex-1">{card.body}</p>
              <span className="public-tap mt-4 inline-flex items-center gap-1.5 font-semibold text-primary underline underline-offset-4 group-hover:no-underline">
                {card.linkLabel}
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </span>
            </>
          );
          const className = "group public-card public-card--brand flex h-full flex-col p-5 md:p-6";
          return (
            <li key={card.id}>
              {isHomeAnchor(card.href) ? (
                <a href={card.href} className={className} data-testid={`card-solution-${card.id}`}>{body}</a>
              ) : (
                <Link href={card.href} className={className} data-testid={`card-solution-${card.id}`}>{body}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </PublicSection>
  );
}
