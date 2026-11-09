import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import type { OverviewItem, OverviewPage, OverviewSection } from "@shared/public-overview-pages";

function ItemBody({ item }: { item: OverviewItem }) {
  return (
    <>
      {item.badge && <p className="public-eyebrow public-eyebrow--brand mb-2">{item.badge}</p>}
      <h3 className="public-h3 text-foreground">{item.title}</h3>
      <p className="public-body public-secondary mt-2">{item.body}</p>
      {item.points && item.points.length > 0 && (
        <ul className="public-small public-secondary mt-3 grid list-disc gap-1 pl-5">
          {item.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
      {item.link && (
        <p className="mt-auto pt-4">
          <Link
            href={item.link.href}
            className="public-tap inline-flex items-center gap-1.5 font-semibold text-primary underline underline-offset-4 hover:no-underline"
          >
            {item.link.label}
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Link>
        </p>
      )}
    </>
  );
}

function SectionView({ page, section, index }: { page: OverviewPage; section: OverviewSection; index: number }) {
  const headingId = `${section.id}-heading`;
  return (
    <PublicSection
      tone={index % 2 === 0 ? "light" : "canvas"}
      id={section.id}
      labelledBy={headingId}
      data-testid={`section-${page.path.slice(1)}-${section.id}`}
    >
      <PublicSectionHeader id={headingId} title={section.heading} description={section.intro} />
      {section.layout === "steps" ? (
        <ol className="grid gap-4 md:grid-cols-2" data-testid={`list-${section.id}`}>
          {section.items.map((item, i) => (
            <li key={item.title} className="public-card flex items-start gap-4 p-5">
              <span className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground" aria-hidden="true">{i + 1}</span>
              <div className="min-w-0">
                <h3 className="public-card-title text-foreground">{item.title}</h3>
                <p className="public-body public-secondary mt-1">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3" data-testid={`list-${section.id}`}>
          {section.items.map((item) => (
            <li key={item.title} className="public-card public-card--brand flex flex-col p-5 md:p-6">
              <ItemBody item={item} />
            </li>
          ))}
        </ul>
      )}
      {section.footnote && <p className="public-caption public-secondary mt-6 max-w-3xl">{section.footnote}</p>}
    </PublicSection>
  );
}

/**
 * Body of an overview page (Payment processing, Pricing & programs): hero heading and lead, content
 * sections, closing contact action. All wording comes from the OverviewPage record, which is shared with
 * the server renderer, so this component writes no copy of its own.
 */
export function OverviewPageView({ page }: { page: OverviewPage }) {
  return (
    <>
      <section className="marketing-surface public-section public-section--light border-b border-border" data-testid="section-overview-hero">
        <div className="public-container">
          <div className="max-w-3xl">
            <h1 className="public-h1 public-h1--page text-foreground" data-testid="text-overview-heading">{page.h1}</h1>
            <p className="public-body public-secondary mt-4 lg:text-lg" data-testid="text-overview-intro">{page.intro}</p>
          </div>
        </div>
      </section>
      {page.sections.map((section, i) => (
        <SectionView key={section.id} page={page} section={section} index={i} />
      ))}
      <PublicSection tone="ink" labelledBy="overview-closing-heading" className="pb-safe-mobile" data-testid="section-overview-closing">
        <div className="max-w-3xl">
          <h2 id="overview-closing-heading" className="public-h2 text-white">{page.closing.heading}</h2>
          <p className="public-body public-secondary mt-3">{page.closing.body}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="public-cta public-cta--inverse gap-2 sm:w-auto" data-testid="link-overview-primary">
              <Link href={page.closing.primary.href}>{page.closing.primary.label}</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="public-cta public-cta--inverse-outline gap-2 sm:w-auto hover:bg-white/10 hover:text-white" data-testid="link-overview-secondary">
              <Link href={page.closing.secondary.href}>{page.closing.secondary.label}</Link>
            </Button>
          </div>
        </div>
      </PublicSection>
    </>
  );
}
