import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Calendar, Mail, Phone, ArrowRight } from "lucide-react";
import { trackPhoneCallClick } from "@/lib/analytics";
import { trackCalendarBooking } from "@/lib/tracking";
import { buildAttributedBookingUrl } from "@/lib/utm";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import {
  ABOUT_CONTACT_HERO,
  ABOUT_CONTACT_INQUIRY,
  ABOUT_CONTACT_INTENTS,
  ABOUT_CONTACT_META,
  ABOUT_CONTACT_PATH,
  ABOUT_CONTACT_PROCESS,
  PUBLIC_CONTACT_CHANNELS,
} from "@shared/public-contact-content";

/**
 * About & Contact. Three starting points, then a stable #inquiry section that lists the real channels
 * (phone, email, booking) and is the mount point for the persisted inquiry flow, then what happens next.
 * No inquiry form is rendered here, and no hours, response time or address is stated because none has
 * owner evidence. Wording lives in shared/public-contact-content.ts and is shared with the server render.
 */
export default function AboutContact() {
  const { phone, email, booking } = PUBLIC_CONTACT_CHANNELS;
  return (
    <div className="min-h-screen flex flex-col">
      <SEO
        title={ABOUT_CONTACT_META.shortTitle}
        description={ABOUT_CONTACT_META.description}
        path={ABOUT_CONTACT_PATH}
        breadcrumbs={[{ name: ABOUT_CONTACT_META.breadcrumbLabel, path: ABOUT_CONTACT_PATH }]}
      />
      <Navbar />

      <main className="flex-grow public-main-offset">
        <section className="marketing-surface public-section public-section--light" data-testid="section-about-hero">
          <div className="public-container">
            <div className="max-w-3xl">
              <h1 className="public-h1 public-h1--page text-foreground mb-4" data-testid="text-about-heading">
                {ABOUT_CONTACT_HERO.heading}
              </h1>
              <p className="public-body public-secondary lg:text-lg" data-testid="text-about-body">
                {ABOUT_CONTACT_HERO.body}
              </p>
            </div>
            <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6" data-testid="grid-contact-intents">
              {ABOUT_CONTACT_INTENTS.map((intent) => (
                <li key={intent.id}>
                  <Link
                    href={intent.href}
                    className="group public-card public-card--brand flex h-full flex-col p-5"
                    data-testid={`card-intent-${intent.id}`}
                  >
                    <h2 className="public-h3 text-foreground">{intent.label}</h2>
                    <p className="public-body public-secondary mt-1 flex-1">{intent.body}</p>
                    <ArrowRight className="mt-3 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <PublicSection tone="warm" id={ABOUT_CONTACT_INQUIRY.id} labelledBy="about-inquiry-heading" className="scroll-mt-24" data-testid="section-inquiry">
          <PublicSectionHeader id="about-inquiry-heading" title={ABOUT_CONTACT_INQUIRY.heading} description={ABOUT_CONTACT_INQUIRY.body} titleTestId="text-inquiry-heading" />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8" data-testid="inquiry-channels">
            <a
              href={phone.href}
              className="public-tap inline-flex items-center gap-2 font-medium text-foreground hover:text-primary"
              data-testid="link-contact-phone"
              onClick={() => trackPhoneCallClick({ sourcePage: ABOUT_CONTACT_PATH })}
            >
              <Phone className="h-4 w-4 text-primary" aria-hidden="true" />
              {phone.label}
            </a>
            <a href={email.href} className="public-tap inline-flex items-center gap-2 font-medium text-foreground hover:text-primary" data-testid="link-contact-email">
              <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
              {email.label}
            </a>
            <Button asChild size="lg" className="public-cta public-cta--brand gap-2 sm:w-auto" data-testid="link-contact-book">
              <a
                href={buildAttributedBookingUrl(booking.href, { ctaLocation: "about_contact_inquiry" })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackCalendarBooking("about_contact_inquiry")}
              >
                <Calendar className="h-4 w-4" aria-hidden="true" />
                {booking.label}
              </a>
            </Button>
          </div>
        </PublicSection>

        <PublicSection tone="canvas" labelledBy="about-process-heading" data-testid="section-how-we-work">
          <PublicSectionHeader id="about-process-heading" title={ABOUT_CONTACT_PROCESS.heading} titleTestId="text-how-we-work-heading" />
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6" data-testid="list-contact-process">
            {ABOUT_CONTACT_PROCESS.steps.map((step, i) => (
              <li key={step.title} className="public-card flex items-start gap-4 p-5" data-testid={`card-step-${i}`}>
                <span className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground" aria-hidden="true">{i + 1}</span>
                <div className="min-w-0">
                  <h3 className="public-card-title text-foreground" data-testid={`text-step-title-${i}`}>{step.title}</h3>
                  <p className="public-body public-secondary mt-1">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </PublicSection>
      </main>

      <Footer />
    </div>
  );
}
