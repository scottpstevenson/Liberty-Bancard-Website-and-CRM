import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { trackPhoneCallClick } from "@/lib/analytics";
import {
  Upload,
  Calendar,
  CheckCircle2,
  Stethoscope,
  Settings,
  Rocket,
  Headphones,
  Phone,
  Mail,
  ArrowRight,
} from "lucide-react";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { CALENDAR_URL } from "@/lib/constants";
import { trackCalendarBooking } from "@/lib/tracking";
import { ABOUT_CONTACT_BOOKING_LABEL, ABOUT_CONTACT_HERO, ABOUT_CONTACT_INTENTS } from "@shared/public-contact-content";

const steps = [
  {
    title: "Diagnose the statement",
    icon: Stethoscope,
  },
  {
    title: 'Recommend best-fit (wholesale vs compliant "0%" where appropriate)',
    icon: Settings,
  },
  {
    title: "Deploy terminal + funding setup",
    icon: Rocket,
  },
  {
    title: "Support after go-live",
    icon: Headphones,
  },
];

const beliefs = [
  "We start with proof (your statement), not a sales pitch",
  "We explain the math in plain English and give options",
  "We build compliance-first programs where permitted",
  "Real human support before and after you go live",
];

export default function AboutContact() {
  const containerRef = useScrollReveal();

  return (
    <div className="min-h-screen flex flex-col">
      <SEO title="About Us & Contact" description="Learn about Liberty Bancard approach to merchant payment processing. Direct support and a statement-based pricing review." path="/about-contact" breadcrumbs={[{ name: "About & Contact", path: "/about-contact" }]} />
      <Navbar />

      <main className="flex-grow public-main-offset" ref={containerRef}>
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
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8" data-testid="hero-contact-row">
              <a
                href="tel:9542668214"
                className="public-tap inline-flex items-center gap-2 font-medium text-foreground hover:text-primary"
                data-testid="link-contact-phone"
                onClick={() => trackPhoneCallClick({ sourcePage: "/about-contact" })}
              >
                <Phone className="h-4 w-4 text-primary" aria-hidden="true" />
                Call/Text 954-266-8214
              </a>
              <a
                href="mailto:support@libertybancard.com"
                className="public-tap inline-flex items-center gap-2 font-medium text-foreground hover:text-primary"
                data-testid="link-contact-email"
              >
                <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
                support@libertybancard.com
              </a>
              <Button asChild size="lg" className="public-cta public-cta--brand gap-2 sm:w-auto" data-testid="link-contact-book">
                <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackCalendarBooking("about_contact_hero")}>
                  <Calendar className="h-4 w-4" aria-hidden="true" />
                  {ABOUT_CONTACT_BOOKING_LABEL}
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section className="bg-muted py-10" data-testid="section-how-we-work">
          <div className="public-container">
            <div className="reveal">
              <h2
                className="public-h2 font-display font-bold text-foreground mb-12 text-center"
                data-testid="text-how-we-work-heading"
              >
                How We <span className="text-accent">Work</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {steps.map((item, i) => (
                <Card key={i} className={`reveal reveal-delay-${i + 1}`} data-testid={`card-step-${i}`}>
                  <CardContent className="pt-8 pb-6 px-6">
                    <div className="w-14 h-14 rounded-md bg-primary flex items-center justify-center mb-5">
                      <span className="text-primary-foreground font-bold text-xl">
                        {i + 1}
                      </span>
                    </div>
                    <div className="flex items-start gap-3 mb-2">
                      <item.icon className="w-6 h-6 text-accent shrink-0 mt-0.5" />
                      <h3
                        className="font-display font-bold text-foreground text-base leading-snug"
                        data-testid={`text-step-title-${i}`}
                      >
                        {item.title}
                      </h3>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-different">
          <div className="public-container">
            <div className="max-w-3xl mx-auto reveal">
              <h2
                className="public-h2 font-display font-bold text-foreground mb-8"
                data-testid="text-different-heading"
              >
                What Makes Liberty <span className="text-accent">Different</span>
              </h2>
              <ul className="space-y-4 mb-8">
                {beliefs.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`different-bullet-${i}`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <Button className="gap-2" asChild>
                <Link href="/upload-statement" data-testid="link-different-upload-statement">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Link>
              </Button>
            </div>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}
