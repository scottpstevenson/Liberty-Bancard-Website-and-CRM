import { Link } from "wouter";
import { Calculator, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FSR_HOME_LINK_TEXT } from "@shared/free-statement-review-content";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PublicImage } from "@/components/public/PublicImage";
import { trackStatementUploadCtaClick } from "@/lib/tracking";

const STEPS = [
  { step: "1", title: "Upload your statement", body: "PDF or photo, about 30 seconds. Redact account numbers if you want; we only need totals and fee lines." },
  { step: "2", title: "We run the Liberty analysis", body: "We review every fee and markup we can identify and calculate your effective cost." },
  { step: "3", title: "Compare 2–3 clear options", body: "Real math, no pressure. See the options side by side and keep the full breakdown either way." },
] as const;

/** Section 4: how it works. Three numbered steps with one supporting review image. */
export function HomeHowItWorks() {
  return (
    <PublicSection tone="warm" labelledBy="home-how-heading" data-testid="section-how-it-works">
      <PublicSectionHeader id="home-how-heading" eyebrow="How it works" title="How the Liberty analysis works" description="Three clear steps, and you keep the results no matter what." titleTestId="text-how-heading" />
      <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-14">
        <ol className="grid gap-4" data-testid="list-how-steps">
          {STEPS.map((item) => (
            <li key={item.step} className="public-card flex items-start gap-4 p-4" data-testid={`step-${item.step}`}>
              <span className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground" aria-hidden="true">{item.step}</span>
              <div className="min-w-0">
                <h3 className="public-card-title text-foreground">{item.title}</h3>
                <p className="public-body public-secondary mt-1">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="public-frame public-frame--fill aspect-video" data-testid="img-how-review">
          <PublicImage id="how-statement-review" variant="wide" sizes="(min-width: 1024px) 520px, 100vw" />
        </div>
      </div>
      <div className="mt-6 flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2">
        <Button asChild className="public-cta gap-2 sm:w-auto" data-testid="link-how-it-works-cta" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: "Start My Liberty Analysis", ctaLocation: "how-it-works" })}>
          <Link href="/upload-statement">
            <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
            Start My Liberty Analysis
          </Link>
        </Button>
        <p data-testid="link-how-it-works-what-we-check-wrapper">
          <Link href="/upload-statement" className="public-tap inline-flex items-center text-primary underline underline-offset-4 hover:no-underline" data-testid="link-how-it-works-what-we-check">
            {FSR_HOME_LINK_TEXT}
          </Link>
        </p>
        <p data-testid="section-calculator-link">
          <Link href="/estimate" className="public-tap inline-flex items-center gap-1.5 text-primary underline underline-offset-4 hover:no-underline" data-testid="link-calculator-estimate">
            <Calculator className="h-4 w-4" aria-hidden="true" />
            No statement handy? Run the 60-second rate check
          </Link>
        </p>
      </div>
    </PublicSection>
  );
}
