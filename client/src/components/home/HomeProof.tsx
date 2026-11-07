import { Link } from "wouter";
import { ArrowRight, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";

/**
 * Section 6: merchant proof. One featured story built only from material already published on
 * /case-studies and the existing testimonial text; no portrait is shown and nothing new is claimed.
 * The two smaller cards are the other documented case-study results and appear from md.
 */
const OTHER_OUTCOMES = [
  { type: "Multi-Location Retail", solution: "Interchange Plus", result: "$3,800/yr", href: "/case-studies#retail-stripe" },
  { type: "Medical Practice", solution: "Interchange Plus + Level 2", result: "$6,100/yr", href: "/case-studies#healthcare-bank" },
] as const;

export function HomeProof() {
  return (
    <PublicSection tone="warm" labelledBy="home-proof-heading" data-testid="section-reviews">
      <PublicSectionHeader id="home-proof-heading" eyebrow="Merchant proof" title="What merchants found after a review" titleTestId="text-reviews-heading" />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="public-card flex flex-col p-6" data-testid="card-proof-featured">
          <p className="public-eyebrow mb-2">Documented case study</p>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="public-h3 text-foreground" data-testid="text-outcome-type-0">Full-Service Restaurant</span>
            <span className="num text-2xl font-bold text-stat-positive" data-testid="text-outcome-result-0">$4,200/yr</span>
          </div>
          <p className="public-caption uppercase tracking-wider public-secondary">Cash Discount Program</p>
          <p className="public-body public-secondary mt-3">The published breakdown of what the statement review found and what changed after the program switch.</p>
          <Button asChild variant="outline" className="public-cta mt-4 gap-2 border-border sm:w-fit">
            <Link href="/case-studies#restaurant-square" data-testid="link-outcome-detail-0">
              Read the restaurant case study <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <figure className="mt-6 border-t border-border pt-6">
            <p className="public-eyebrow mb-2">Merchant testimonial</p>
            <Quote className="h-8 w-8 text-primary/20" aria-hidden="true" />
            <blockquote className="display-serif public-h3 mt-1 font-normal text-foreground" data-testid="text-review-quote-0">
              We uploaded our statement, and Liberty showed us exactly where our fees were coming from. We switched programs and our monthly processing cost dropped meaningfully. I wish I'd done it two years earlier.
            </blockquote>
            <figcaption className="public-small mt-3 text-foreground">
              <span className="font-semibold" data-testid="text-review-name-0">Maria R.</span>
              <span className="public-secondary" data-testid="text-review-role-0"> · Restaurant Owner · South Miami, FL</span>
            </figcaption>
            <p className="public-caption public-secondary mt-2">* Individual outcomes vary. Based on documented statement review and merchant setup. The testimonial and the case-study figure above are separate sources.</p>
            <Button asChild variant="ghost" className="public-cta mt-2 gap-2 sm:w-fit">
              <Link href="/testimonials" data-testid="link-video-testimonials-all">Watch merchant stories</Link>
            </Button>
          </figure>
        </div>
        <div className="hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-1 lg:content-start" data-testid="grid-outcomes-strip">
          {OTHER_OUTCOMES.map((o, i) => (
            <Link key={o.href} href={o.href} className="public-card block p-4 hover:border-primary/40" data-testid={`link-outcome-detail-${i + 1}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="public-small font-semibold text-foreground" data-testid={`text-outcome-type-${i + 1}`}>{o.type}</span>
                <span className="num text-lg font-bold text-stat-positive" data-testid={`text-outcome-result-${i + 1}`}>{o.result}</span>
              </div>
              <p className="public-caption uppercase tracking-wider public-secondary">{o.solution}</p>
            </Link>
          ))}
        </div>
      </div>
      <p className="public-caption public-secondary mt-4">Documented case-study results. Individual outcomes vary by card mix, volume, and program eligibility.</p>
    </PublicSection>
  );
}
