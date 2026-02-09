import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Upload,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Smartphone,
  Zap,
  ShieldCheck,
  Phone,
} from "lucide-react";

const costBullets = [
  "Your effective rate is often higher than the advertised flat rate once all fees are included",
  "Card mix matters - rewards cards, corporate cards, and international cards cost more, but flat-rate pricing hides this",
  "Downgrades from missing data or incorrect transaction types silently increase your cost",
  "Keyed-in transactions cost significantly more than swiped, dipped, or tapped - flat-rate pricing masks the difference",
  "Funding delays with aggregators can mean waiting 2-3 business days instead of next-day access to your money",
];

const whatYouGet = [
  "Your true effective rate calculated from your actual statement, not an estimate",
  "A side-by-side comparison of your current flat-rate cost vs. interchange-plus and other options",
  "A clear implementation plan with timeline, terminal setup, and zero downtime migration",
];

const terminalFeatures = [
  { icon: Smartphone, label: "Tap, chip, and swipe - all payment methods supported" },
  { icon: Zap, label: "Fast setup with pre-configured settings for your account" },
  { icon: ShieldCheck, label: "Reliable checkout with built-in dual pricing support" },
];

const faqItems = [
  {
    question: "How does migration work? Will there be downtime?",
    answer:
      "We handle the entire migration process. Your new terminal arrives pre-configured and ready to process. You can run both systems side by side during the transition, so there is zero downtime for your business.",
  },
  {
    question: "What about my online payments?",
    answer:
      "We support online and e-commerce payment processing with competitive interchange-plus pricing. If you currently use Square or Stripe for online payments, we can provide a gateway solution that integrates with your existing website or shopping cart.",
  },
  {
    question: "What if I don't have a current statement to upload?",
    answer:
      "If you are a new business or don't have a recent statement, you can still book a call with us. We will walk through your expected volume, ticket size, and business type to provide a preliminary recommendation.",
  },
];

export default function BeatSquareStripe() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />

      <main className="flex-grow pt-16">
        {/* Hero */}
        <section className="bg-background py-20 lg:py-28" data-testid="section-beat-hero">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <h1
                className="text-4xl md:text-5xl font-display font-bold text-foreground leading-tight mb-6"
                data-testid="text-beat-heading"
              >
                Flat-Rate Is Convenient - Until You See the All-In Cost.
              </h1>
              <p
                className="text-lg text-muted-foreground mb-8 leading-relaxed"
                data-testid="text-beat-subheadline"
              >
                Square, Stripe, and other flat-rate processors are easy to start with. But as
                your volume grows, that simple percentage becomes one of your largest monthly
                expenses. We show you exactly what you are paying and whether a better structure
                exists for your business.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                <Link href="/upload-statement" data-testid="link-beat-primary-cta">
                  <Button size="lg" className="gap-2">
                    <Upload className="w-4 h-4" />
                    Compare My Statement
                  </Button>
                </Link>
                <a href="#" data-testid="link-beat-secondary-cta">
                  <Button size="lg" variant="outline" className="gap-2">
                    <Phone className="w-4 h-4" />
                    Book a 10-Minute Call
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Why Flat-Rate Can Cost More */}
        <section className="bg-muted py-20" data-testid="section-cost-more">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-cost-more-heading"
              >
                Why Flat-Rate Can Cost More
              </h2>
              <ul className="space-y-4">
                {costBullets.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`cost-bullet-${i}`}
                  >
                    <AlertTriangle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* What You Get */}
        <section className="bg-background py-20" data-testid="section-beat-what-you-get">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-beat-what-you-get-heading"
              >
                What You Get
              </h2>
              <ul className="space-y-4 mb-8">
                {whatYouGet.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`beat-get-bullet-${i}`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <Link href="/upload-statement" data-testid="link-beat-get-upload">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload My Statement
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Terminal Block */}
        <section className="bg-muted py-20" data-testid="section-terminal">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <Card data-testid="card-terminal-block">
                <CardHeader>
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-3">
                    <CreditCard className="w-5 h-5 text-primary" />
                  </div>
                  <CardTitle className="text-2xl">Liberty Smart Terminal - Dejavoo QD4</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-6">
                    Modern, reliable terminal hardware that supports every payment method your
                    customers expect. Pre-configured for your account and ready to process on
                    arrival.
                  </p>
                  <ul className="space-y-4">
                    {terminalFeatures.map((item, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3"
                        data-testid={`terminal-feature-${i}`}
                      >
                        <item.icon className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">{item.label}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-background py-20" data-testid="section-beat-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-beat-faq-heading"
              >
                Frequently Asked Questions
              </h2>
              <Accordion type="single" collapsible className="w-full">
                {faqItems.map((item, i) => (
                  <AccordionItem key={i} value={`faq-${i}`} data-testid={`beat-faq-item-${i}`}>
                    <AccordionTrigger
                      className="text-left"
                      data-testid={`beat-faq-trigger-${i}`}
                    >
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent data-testid={`beat-faq-content-${i}`}>
                      <p className="text-muted-foreground">{item.answer}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-muted py-20" data-testid="section-beat-final-cta">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
              data-testid="text-beat-final-cta-heading"
            >
              Want the Truth in Writing?
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
              Upload your statement and get a written, line-item breakdown that shows exactly
              what you are paying - and what you could be paying instead.
            </p>
            <Link href="/upload-statement" data-testid="link-beat-final-cta">
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
