import { Link } from "wouter";
import { CheckCircle2, FileText, Scale, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { trackStatementUploadCtaClick } from "@/lib/tracking";
import { SampleReviewCard } from "./SampleReviewCard";

const BENEFITS = [
  { icon: Scale, title: "Your true effective rate", body: "Total fees divided by volume, so you can compare it to what you were quoted." },
  { icon: FileText, title: "Every fee itemized", body: "Markup, monthly fixed fees, downgrades, PCI, batch and other add-ons, line by line." },
  { icon: CheckCircle2, title: "2–3 clear options", body: "Real math, no pressure. You keep the full breakdown whether or not you switch." },
] as const;

/** Section 2: what the review gives you. One labelled sample beside three benefits (replaces the sample / trust / pain / deliverables sections). */
export function HomeReview() {
  return (
    <PublicSection tone="warm" labelledBy="home-review-heading" data-testid="section-what-you-get">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-14">
        <div>
          <PublicSectionHeader id="home-review-heading" eyebrow="What the review gives you" title="Know exactly what you pay and why" titleTestId="text-review-heading" />
          <ul className="grid gap-4" data-testid="list-review-benefits">
            {BENEFITS.map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <item.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </span>
                <div>
                  <p className="public-card-title text-foreground">{item.title}</p>
                  <p className="public-body public-secondary">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <Button asChild className="public-cta mt-6 gap-2 sm:w-auto" data-testid="link-review-upload" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: "Start My Liberty Analysis", ctaLocation: "what-you-get" })}>
            <Link href="/upload-statement">
              <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
              Start My Liberty Analysis
            </Link>
          </Button>
        </div>
        <SampleReviewCard className="mx-auto w-full max-w-md lg:max-w-none" />
      </div>
    </PublicSection>
  );
}
