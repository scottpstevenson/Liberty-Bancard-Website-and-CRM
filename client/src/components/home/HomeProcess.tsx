import { Link } from "wouter";
import { Calculator, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { HOME_PROCESS } from "@shared/public-home-content";
import { trackStatementUploadCtaClick } from "@/lib/tracking";
import { SampleReviewCard } from "./SampleReviewCard";

/**
 * Process worksheet: three plain steps beside the illustrative review layout (a worksheet with dashes,
 * never a result). Step wording comes from shared/public-home-content.ts, which reads claim records for
 * the review and timing statements, so the server-rendered Home shows the same steps.
 */
export function HomeProcess() {
  const [reviewLink, rateCheckLink] = HOME_PROCESS.links;
  return (
    <PublicSection tone="warm" data-home-section="process" labelledBy="home-process-heading" data-testid="section-how-it-works">
      <PublicSectionHeader id="home-process-heading" eyebrow={HOME_PROCESS.eyebrow} title={HOME_PROCESS.heading} titleTestId="text-how-heading" />
      <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-start lg:gap-14">
        <ol className="grid gap-4" data-testid="list-how-steps">
          {HOME_PROCESS.steps.map((item, i) => (
            <li key={item.title} className="public-card flex items-start gap-4 p-4" data-testid={`step-${i + 1}`}>
              <span className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground" aria-hidden="true">{i + 1}</span>
              <div className="min-w-0">
                <h3 className="public-card-title text-foreground">{item.title}</h3>
                <p className="public-body public-secondary mt-1">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <SampleReviewCard />
      </div>
      <div className="mt-6 flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2">
        <Button asChild className="public-cta gap-2 sm:w-auto" data-testid="link-how-it-works-cta" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: reviewLink.label, ctaLocation: "how-it-works" })}>
          <Link href={reviewLink.href}>
            <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
            {reviewLink.label}
          </Link>
        </Button>
        <p data-testid="section-calculator-link">
          <Link href={rateCheckLink.href} className="public-tap inline-flex items-center gap-1.5 text-primary underline underline-offset-4 hover:no-underline" data-testid="link-calculator-estimate">
            <Calculator className="h-4 w-4" aria-hidden="true" />
            {rateCheckLink.label}
          </Link>
        </p>
      </div>
    </PublicSection>
  );
}
