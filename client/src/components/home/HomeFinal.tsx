import { Link } from "wouter";
import { ArrowRight, Calendar, CheckCircle2, Phone, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicSection } from "@/components/public/PublicSection";
import { CALENDAR_URL, PHONE_NUMBER, PHONE_TEL } from "@/lib/constants";
import { trackBookingCtaClick, trackStatementUploadCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import { HomeCallbackForm } from "./HomeCallbackForm";

/**
 * Section 8: final action. Upload / Book / Phone as three plainly different choices, plus the
 * existing callback request. One offer, no second hero image.
 */
export function HomeFinal() {
  return (
    <PublicSection tone="ink" labelledBy="home-final-heading" className="pb-safe-mobile" data-testid="section-final-cta">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-14">
        <div>
          <p className="public-eyebrow mb-2">Liberty statement review</p>
          <h2 id="home-final-heading" className="public-h2 text-white" data-testid="text-final-cta-heading">
            Your statement tells the truth. Let's read it together.
          </h2>
          <p className="public-body public-secondary mt-3 max-w-xl">30 seconds to upload. Most reviews finish the same business day. You keep the breakdown no matter what.</p>
          <ul className="public-small mt-4 grid gap-2 text-white/90">
            {["No obligation", "No contract to see your numbers", "Yours to keep"].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-testid="final-cta-block">
            <Button asChild size="lg" className="public-cta public-cta--inverse gap-2 sm:w-auto" data-testid="link-final-upload" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: "Get My Free Analysis", ctaLocation: "final-cta" })}>
              <Link href="/upload-statement">
                <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                Get My Free Analysis
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="public-cta public-cta--inverse-outline gap-2 sm:w-auto hover:bg-white/10 hover:text-white">
              <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="link-final-book" onClick={() => trackBookingCtaClick({ page: "/", ctaLabel: "Book a review call", ctaLocation: "final-cta" })}>
                <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
                Book a review call
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="public-cta public-cta--inverse-outline gap-2 sm:w-auto hover:bg-white/10 hover:text-white">
              <a href={PHONE_TEL} data-testid="link-final-phone" onClick={() => trackPhoneCallClick({ sourcePage: "/" })}>
                <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                Call {PHONE_NUMBER}
              </a>
            </Button>
          </div>
          <p className="public-small mt-3">
            <Link href="/get-started" className="public-tap inline-flex items-center gap-1 text-sky-200 underline underline-offset-4 hover:no-underline" data-testid="link-final-quiz">
              Or take the 60-second quiz <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </p>
          <p className="public-caption mt-3 max-w-xl text-white/80" data-testid="text-final-cta-microcopy">
            Eligibility, underwriting, card brand rules, and applicable laws apply.
          </p>
        </div>
        <div id="callback" data-testid="section-callback">
          <h3 className="public-h3 mb-1 text-white" data-testid="text-callback-heading">Rather talk it through?</h3>
          <p className="public-body public-secondary mb-4">Drop your number. A real person calls you back — no call center, no script, no pitch.</p>
          <HomeCallbackForm />
        </div>
      </div>
    </PublicSection>
  );
}
