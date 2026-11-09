import { Link } from "wouter";
import { ArrowRight, HardHat } from "lucide-react";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PublicImage } from "@/components/public/PublicImage";
import { cn } from "@/lib/utils";
import { HOME_INDUSTRIES_SECTION } from "@shared/public-home-content";
import { HOME_INDUSTRIES } from "./home-content";

/**
 * Section 3: businesses we serve. Compact photo rows on phones, an image-led grid from md
 * (three plus two at tablet width, one row of five on desktop).
 * Every entry is one link to its existing /industries/:slug template; the images come from the
 * public imagery dataset and are illustrative, never a named customer. An entry with no registered
 * photograph (field services) shows a native icon tile instead of a mismatched picture.
 */
export function HomeIndustries() {
  return (
    <PublicSection tone="canvas" data-home-section="industries" labelledBy="home-industries-heading" data-testid="section-verticals">
      <PublicSectionHeader id="home-industries-heading" eyebrow={HOME_INDUSTRIES_SECTION.eyebrow} title={HOME_INDUSTRIES_SECTION.heading} description={HOME_INDUSTRIES_SECTION.description} titleTestId="text-verticals-heading" />
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-6 md:gap-5 lg:grid-cols-5" data-testid="grid-verticals">
        {HOME_INDUSTRIES.map((item, i) => (
          <li key={item.slug} className={cn("md:col-span-2 lg:col-span-1", i >= 3 && "md:col-span-3 lg:col-span-1")}>
            <Link
              href={`/industries/${item.slug}`}
              className="group public-card flex h-full items-center gap-3 overflow-hidden p-2 hover:border-primary/40 md:flex-col md:items-stretch md:gap-0 md:p-0"
              data-testid={`card-vertical-${i}`}
            >
              <div className="public-frame w-24 shrink-0 rounded-lg md:w-full md:rounded-none">
                {item.image ? (
                  <PublicImage id={item.image} variant="card" sizes="(min-width: 1024px) 230px, (min-width: 768px) 33vw, 96px" imgClassName="aspect-[4/3] object-cover md:aspect-[16/10] lg:aspect-[4/3]" />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-muted text-primary md:aspect-[16/10] lg:aspect-[4/3]" data-testid={`icon-vertical-${i}`} aria-hidden="true">
                    <HardHat className="h-8 w-8 md:h-10 md:w-10" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 py-1 pr-2 md:p-4">
                <h3 className="public-card-title text-foreground">{item.title}</h3>
                <p className="public-small public-secondary">Best for: {item.bestFor}</p>
              </div>
              <ArrowRight className="mr-2 h-4 w-4 shrink-0 text-muted-foreground md:hidden" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4">
        <Link href={HOME_INDUSTRIES_SECTION.allHref} className="public-tap inline-flex items-center gap-1.5 font-semibold text-primary underline underline-offset-4 hover:no-underline" data-testid="link-all-industries">
          {HOME_INDUSTRIES_SECTION.allLabel} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </p>
      <p className="public-caption public-secondary mt-2" data-testid="text-verticals-illustrative">
        {HOME_INDUSTRIES_SECTION.illustrativeNote}
      </p>
    </PublicSection>
  );
}
