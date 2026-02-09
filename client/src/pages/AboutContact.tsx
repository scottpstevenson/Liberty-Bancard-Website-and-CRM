import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Upload,
  ArrowRight,
  CheckCircle2,
  Stethoscope,
  Settings,
  Rocket,
  Headphones,
  Phone,
  Mail,
  Calendar,
} from "lucide-react";

const processSteps = [
  {
    step: "1",
    title: "Diagnose",
    detail:
      "We read your processing statement line by line and calculate your true effective rate, identifying every cost driver.",
    icon: Stethoscope,
  },
  {
    step: "2",
    title: "Recommend",
    detail:
      "You receive a written breakdown with 2-3 clear options - wholesale pricing, compliant 0% programs, or a combination that fits your business.",
    icon: Settings,
  },
  {
    step: "3",
    title: "Deploy",
    detail:
      "We handle terminal configuration, compliance setup, card brand registration, and staff training. Zero downtime migration.",
    icon: Rocket,
  },
  {
    step: "4",
    title: "Support",
    detail:
      "Ongoing monitoring, rule change updates, and direct access to a real human when you need help. Not a call center.",
    icon: Headphones,
  },
];

const differentiators = [
  "We show proof before asking you to switch - your breakdown is yours to keep even if you stay with your current processor",
  "No pressure sales tactics, no inflated savings claims, no bait-and-switch pricing",
  "Every recommendation is backed by your actual statement data, not estimates or industry averages",
  "Direct support from people who understand payment processing, not scripted call center agents",
];

export default function AboutContact() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />

      <main className="flex-grow pt-16">
        {/* Hero */}
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
                className="text-lg text-muted-foreground leading-relaxed"
                data-testid="text-about-body"
              >
                Liberty Bancard helps operators stop overpaying and stop guessing with
                line-item statement diagnostics, clear options, and support that sticks around.
              </p>
            </div>
          </div>
        </section>

        {/* How We Work */}
        <section className="bg-muted py-20" data-testid="section-how-we-work">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-foreground mb-12 text-center"
              data-testid="text-how-we-work-heading"
            >
              How We Work
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {processSteps.map((item, i) => (
                <Card key={i} data-testid={`card-step-${i}`}>
                  <CardContent className="pt-6">
                    <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center mb-4">
                      <span className="text-primary-foreground font-bold text-lg">
                        {item.step}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <item.icon className="w-5 h-5 text-primary shrink-0" />
                      <h3 className="font-display font-bold text-foreground text-lg">
                        {item.title}
                      </h3>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.detail}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* What Makes Liberty Different */}
        <section className="bg-background py-20" data-testid="section-different">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-different-heading"
              >
                What Makes Liberty Different
              </h2>
              <ul className="space-y-4">
                {differentiators.map((item, i) => (
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
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section className="bg-muted py-20" data-testid="section-contact">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-contact-heading"
              >
                Get in Touch
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
                <Card data-testid="card-contact-phone">
                  <CardContent className="pt-6 text-center">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <Phone className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-display font-bold text-foreground mb-2">Call or Text</h3>
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
                    <h3 className="font-display font-bold text-foreground mb-2">Book a Call</h3>
                    <a
                      href="#"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="link-contact-book"
                    >
                      Schedule 10-Minute Call
                    </a>
                  </CardContent>
                </Card>
              </div>

              <a href="tel:9542668214" data-testid="link-tap-to-call">
                <Button size="lg" className="gap-2">
                  <Phone className="w-4 h-4" />
                  Tap to Call 954-266-8214
                </Button>
              </a>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-background py-20" data-testid="section-about-final-cta">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
              data-testid="text-about-final-cta-heading"
            >
              Ready to See What You Are Really Paying?
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
              Upload your statement and get a written breakdown - yours to keep, no obligation.
            </p>
            <Link href="/upload-statement" data-testid="link-about-final-cta">
              <Button size="lg" className="gap-2">
                <Upload className="w-4 h-4" />
                Upload My Statement
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
