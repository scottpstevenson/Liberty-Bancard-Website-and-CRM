import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
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
} from "lucide-react";
import heroTeam from "@assets/images/hero-team.jpg";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { CALENDAR_URL } from "@/lib/constants";

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
      <SEO title="About Us & Contact" description="Learn about Liberty Bancard's approach to merchant payment processing. Direct support, transparent pricing, no long-term contracts." path="/about-contact" breadcrumbs={[{ name: "About & Contact", path: "/about-contact" }]} />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>
        <section className="relative overflow-hidden" data-testid="section-about-hero">
          <div className="absolute inset-0">
            <img src={heroTeam} alt="Liberty Bancard team of payment processing professionals" className="w-full h-full object-cover" width="1408" height="792" />
            <div className="absolute inset-0 bg-gradient-to-r from-[hsl(222,47%,6%)/0.97] via-[hsl(222,47%,6%)/0.93] to-[hsl(222,47%,6%)/0.85]" />
          </div>
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="glow-blob glow-blob-2 w-48 h-48 bg-blue-600 bottom-10 left-1/4" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32">
            <div className="max-w-3xl reveal">
              <h1
                className="text-4xl md:text-5xl font-display font-bold text-white leading-tight mb-6"
                data-testid="text-about-heading"
              >
                <span className="text-sky-400">Merchant-First</span> Support. Statement-First Pricing.
              </h1>
              <p
                className="text-lg text-white/70 leading-relaxed mb-8"
                data-testid="text-about-body"
              >
                Liberty Bancard helps operators stop overpaying and stop guessing with line-item statement diagnostics, clear options, and support that sticks around.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link href="/upload-statement" data-testid="link-hero-upload-statement">
                  <Button className="gap-2 cta-pulse">
                    <Upload className="w-4 h-4" />
                    Upload Statement
                  </Button>
                </Link>
                <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="link-hero-book-call">
                  <Button variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                    <Calendar className="w-4 h-4" />
                    Book a 10-Minute Call
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted bg-dots py-20" data-testid="section-how-we-work">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-12 text-center"
                data-testid="text-how-we-work-heading"
              >
                How We <span className="text-sky-400">Work</span>
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
                      <item.icon className="w-6 h-6 text-sky-400 shrink-0 mt-0.5" />
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

        <section className="bg-background bg-grid py-20" data-testid="section-different">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto reveal">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-different-heading"
              >
                What Makes Liberty <span className="text-sky-400">Different</span>
              </h2>
              <ul className="space-y-4 mb-8">
                {beliefs.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`different-bullet-${i}`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <Link href="/upload-statement" data-testid="link-different-upload-statement">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-muted bg-dots py-20" data-testid="section-contact">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <div className="reveal">
                <h2
                  className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8 text-center"
                  data-testid="text-contact-heading"
                >
                  Contact <span className="text-sky-400">Liberty Bancard</span>
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
                <Card className="reveal reveal-delay-1" data-testid="card-contact-phone">
                  <CardContent className="pt-6 text-center">
                    <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <Phone className="w-6 h-6 text-sky-400" />
                    </div>
                    <h3 className="font-display font-bold text-foreground mb-2">Call/Text</h3>
                    <a
                      href="tel:9542668214"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="link-contact-phone"
                    >
                      954-266-8214
                    </a>
                  </CardContent>
                </Card>

                <Card className="reveal reveal-delay-2" data-testid="card-contact-email">
                  <CardContent className="pt-6 text-center">
                    <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <Mail className="w-6 h-6 text-sky-400" />
                    </div>
                    <h3 className="font-display font-bold text-foreground mb-2">Email</h3>
                    <a
                      href="mailto:support@libertybancard.com"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="link-contact-email"
                    >
                      support@libertybancard.com
                    </a>
                  </CardContent>
                </Card>

                <Card className="reveal reveal-delay-3" data-testid="card-contact-book">
                  <CardContent className="pt-6 text-center">
                    <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <Calendar className="w-6 h-6 text-sky-400" />
                    </div>
                    <h3 className="font-display font-bold text-foreground mb-2">Book</h3>
                    <a
                      href={CALENDAR_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="link-contact-book"
                    >
                      Schedule a 10-minute call →
                    </a>
                  </CardContent>
                </Card>
              </div>

              <div className="text-center reveal reveal-delay-4">
                <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="link-contact-book-call">
                  <Button className="gap-2">
                    <Calendar className="w-4 h-4" />
                    Book a 10-Minute Call
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
