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
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow pt-28">
        <section className="bg-background py-20 lg:py-28" data-testid="section-about-hero">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <h1
                className="text-4xl md:text-5xl font-display font-bold text-foreground leading-tight mb-6"
                data-testid="text-about-heading"
              >
                Merchant-First Support. Statement-First Pricing.
              </h1>
              <p
                className="text-lg text-muted-foreground leading-relaxed mb-8"
                data-testid="text-about-body"
              >
                Liberty Bancard helps operators stop overpaying and stop guessing with line-item statement diagnostics, clear options, and support that sticks around.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link href="/upload-statement" data-testid="link-hero-upload-statement">
                  <Button className="gap-2">
                    <Upload className="w-4 h-4" />
                    Upload Statement
                  </Button>
                </Link>
                <a href="#" data-testid="link-hero-book-call">
                  <Button variant="outline" className="gap-2">
                    <Calendar className="w-4 h-4" />
                    Book a 10-Minute Call
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted py-20" data-testid="section-how-we-work">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-foreground mb-12 text-center"
              data-testid="text-how-we-work-heading"
            >
              How We Work
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {steps.map((item, i) => (
                <Card key={i} data-testid={`card-step-${i}`}>
                  <CardContent className="pt-6">
                    <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center mb-4">
                      <span className="text-primary-foreground font-bold text-lg">
                        {i + 1}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <item.icon className="w-5 h-5 text-primary shrink-0" />
                      <h3
                        className="font-display font-bold text-foreground text-base"
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

        <section className="bg-background py-20" data-testid="section-different">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-different-heading"
              >
                What Makes Liberty Different
              </h2>
              <ul className="space-y-4 mb-8">
                {beliefs.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`different-bullet-${i}`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
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

        <section className="bg-muted py-20" data-testid="section-contact">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8 text-center"
                data-testid="text-contact-heading"
              >
                Contact Liberty Bancard
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
                <Card data-testid="card-contact-phone">
                  <CardContent className="pt-6 text-center">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <Phone className="w-5 h-5 text-primary" />
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

                <Card data-testid="card-contact-email">
                  <CardContent className="pt-6 text-center">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <Mail className="w-5 h-5 text-primary" />
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

                <Card data-testid="card-contact-book">
                  <CardContent className="pt-6 text-center">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <Calendar className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-display font-bold text-foreground mb-2">Book</h3>
                    <a
                      href="#"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="link-contact-book"
                    >
                      Calendar link placeholder
                    </a>
                  </CardContent>
                </Card>
              </div>

              <div className="text-center">
                <a href="#" data-testid="link-contact-book-call">
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
