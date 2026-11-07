import { Link } from "wouter";
import { ArrowRight, BadgeCheck, Calendar, Phone, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicImage } from "@/components/public/PublicImage";
import { CALENDAR_URL, PHONE_NUMBER, PHONE_TEL } from "@/lib/constants";
import { trackBookingCtaClick, trackStatementUploadCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import { COMPLIANCE_LINE, SAMPLE_FINDINGS } from "./home-content";

/**
 * Section 1: merchant-first hero. Upload and Book sit directly under the headline; the payment-moment
 * photo follows the actions on phones and takes the right ~45% from lg. The photo is the page's only
 * eager image and the frame owns its aspect ratio at each breakpoint, so nothing shifts when it loads.
 * Hero copy and CTAs are never animated from opacity 0 (they are the LCP candidate).
 */
export function HomeHero() {
  const inset = SAMPLE_FINDINGS.slice(0, 2);
  return (
    <section className="marketing-surface relative bg-background border-b border-border" data-testid="section-hero">
      <div className="public-container pt-6 pb-8 lg:py-16">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[11fr_9fr] lg:grid-rows-[auto_auto] lg:gap-x-14 lg:gap-y-0">
          <div className="lg:self-end">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 public-caption font-medium public-secondary" data-testid="text-hero-badge">
              <BadgeCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              South Florida Merchant Services
            </div>
            <h1 className="public-h1 mb-4 max-w-[20ch] text-foreground" data-testid="text-hero-heading">
              <span className="text-accent">Credit Card Processing</span> Without the Rate Games
            </h1>
            <p className="public-body public-secondary mb-5 max-w-xl lg:text-lg" data-testid="text-hero-subheadline">
              Upload a recent processing statement and we'll show your effective rate, markup, monthly fees, and hidden charges — before you switch.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row" data-testid="hero-cta-block">
              <Button asChild size="lg" className="public-cta gap-2 sm:w-auto" data-testid="link-hero-upload" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: "Upload My Statement — Free", ctaLocation: "hero" })}>
                <Link href="/upload-statement">
                  <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Upload My Statement — Free
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="public-cta gap-2 border-border sm:w-auto">
                <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="link-hero-book" onClick={() => trackBookingCtaClick({ page: "/", ctaLabel: "Book a review call", ctaLocation: "hero" })}>
                  <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Book a review call
                </a>
              </Button>
            </div>
            <p className="public-small public-secondary mt-3 max-w-md" data-testid="text-hero-microcopy">
              Upload a PDF or photo. Takes 30 seconds. You can redact account numbers — totals and fee lines are enough.
            </p>
          </div>

          <div className="lg:row-span-2 lg:row-start-1 lg:col-start-2 lg:self-center" data-testid="hero-visual">
            <div className="public-frame public-frame--fill aspect-[4/3] lg:aspect-[1060/896]">
              <PublicImage
                id="hero-terminal-tap"
                variant="mobile"
                sizes="100vw"
                artDirection={[{ variant: "desktop", media: "(min-width: 1024px)", sizes: "(min-width: 1200px) 520px, 42vw" }]}
                priority
                data-testid="img-hero-terminal"
              />
              <div className="absolute inset-x-3 bottom-3 hidden rounded-lg border border-border bg-card/95 p-3 shadow-card lg:block" data-testid="hero-sample-inset">
                <p className="public-caption mb-1 font-semibold uppercase tracking-wider public-secondary">Sample review · illustrative</p>
                <dl className="grid grid-cols-2 gap-3">
                  {inset.map((row) => (
                    <div key={row.label}>
                      <dt className="public-caption public-secondary">{row.label}</dt>
                      <dd className="num text-base font-semibold text-stat-negative">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>

          <div className="lg:self-start lg:pt-6">
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 public-small font-medium text-foreground" data-testid="hero-trust-row">
              {["Free statement review", "No processor login needed", "South Florida team"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <BadgeCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-x-5">
              <a href={PHONE_TEL} aria-label="Call Liberty Bancard" className="public-tap inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary" data-testid="link-hero-phone" onClick={() => trackPhoneCallClick({ sourcePage: "/" })}>
                <Phone className="h-4 w-4 text-primary" aria-hidden="true" />
                Call {PHONE_NUMBER}
              </a>
              <Link href="/beat-square-stripe" className="public-tap hidden items-center gap-1.5 text-sm text-foreground hover:text-primary lg:inline-flex" data-testid="link-hero-compare">
                Compare My Current Setup
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            <p className="public-caption public-secondary mt-2 max-w-md" data-testid="text-hero-compliance">
              {COMPLIANCE_LINE}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
