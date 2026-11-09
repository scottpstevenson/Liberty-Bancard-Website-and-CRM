import { Link } from "wouter";
import { ArrowRight, Calendar, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicSection } from "@/components/public/PublicSection";
import { trackBookingCtaClick, trackStatementUploadCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import { buildAttributedBookingUrl } from "@/lib/utm";
import { HOME_FINAL } from "@shared/public-home-content";
import { HomeCallbackForm } from "./HomeCallbackForm";

const OUTLINE = "public-cta public-cta--inverse-outline gap-2 sm:w-auto hover:bg-white/10 hover:text-white";

/**
 * Final contact section. Talk to Liberty and the statement review are the two primary choices; phone,
 * email and booking are listed as plain channels. The existing callback request stays (hydrated only; the
 * server document links to the contact options instead). No hours, response time or text capability is
 * stated, and the wording comes from shared/public-home-content.ts.
 */
export function HomeFinal() {
  const [talk, review] = HOME_FINAL.actions;
  const [phone, email, booking] = HOME_FINAL.channels;
  return (
    <PublicSection tone="ink" data-home-section="final" labelledBy="home-final-heading" className="pb-safe-mobile" data-testid="section-final-cta">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-14">
        <div>
          <p className="public-eyebrow mb-2">{HOME_FINAL.eyebrow}</p>
          <h2 id="home-final-heading" className="public-h2 text-white" data-testid="text-final-cta-heading">
            {HOME_FINAL.heading}
          </h2>
          <p className="public-body public-secondary mt-3 max-w-xl">{HOME_FINAL.body}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-testid="final-cta-block">
            <Button asChild size="lg" className="public-cta public-cta--inverse gap-2 sm:w-auto" data-testid="link-final-talk">
              <Link href={talk.href}>
                {talk.label}
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className={OUTLINE} data-testid="link-final-upload" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: review.label, ctaLocation: "final-cta" })}>
              <Link href={review.href}>{review.label}</Link>
            </Button>
          </div>
          <ul className="public-small mt-5 grid gap-1 text-white/90" aria-label="Other ways to reach Liberty" data-testid="list-final-channels">
            <li>
              <a href={phone.href} className="public-tap inline-flex items-center gap-2 underline underline-offset-4 hover:no-underline" data-testid="link-final-phone" onClick={() => trackPhoneCallClick({ sourcePage: "/" })}>
                <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                {phone.label}
              </a>
            </li>
            <li>
              <a href={email.href} className="public-tap inline-flex items-center gap-2 underline underline-offset-4 hover:no-underline" data-testid="link-final-email">
                <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                {email.label}
              </a>
            </li>
            <li>
              <a href={buildAttributedBookingUrl(booking.href, { ctaLocation: "final-cta" })} target="_blank" rel="noopener noreferrer" className="public-tap inline-flex items-center gap-2 underline underline-offset-4 hover:no-underline" data-testid="link-final-book" onClick={() => trackBookingCtaClick({ page: "/", ctaLabel: booking.label, ctaLocation: "final-cta" })}>
                <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
                {booking.label}
              </a>
            </li>
          </ul>
          <p className="public-caption mt-4 max-w-xl text-white/80" data-testid="text-final-cta-microcopy">
            {HOME_FINAL.disclosure}
          </p>
        </div>
        <div id="callback" data-testid="section-callback">
          <h3 className="public-h3 mb-1 text-white" data-testid="text-callback-heading">{HOME_FINAL.callback.heading}</h3>
          <p className="public-body public-secondary mb-4">{HOME_FINAL.callback.body}</p>
          <HomeCallbackForm />
        </div>
      </div>
    </PublicSection>
  );
}
