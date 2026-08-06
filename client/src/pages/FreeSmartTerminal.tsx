import { SEO, getServiceSchema, getFAQSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Upload,
  CheckCircle2,
  ShieldCheck,
  Phone,
  Calendar,
  ArrowRight,
  Monitor,
  Zap,
  DollarSign,
  BadgeCheck,
  Wifi,
  CreditCard,
  Clock,
  AlertCircle,
} from "lucide-react";
import { PHONE_TEL, PHONE_NUMBER, CALENDAR_URL } from "@/lib/constants";
import { trackFreeTerminalEligibilityClick, trackStatementUploadCtaClick, trackBookingCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import imgCloverFlex3 from "@assets/images/terminal-clover-flex-3.png";
import imgPaxA920 from "@assets/images/terminal-pax-a920.png";
import {
  FST_TITLE,
  FST_DESCRIPTION,
  FST_KEYWORDS,
  FST_PATH,
  FST_SERVICE_NAME,
  FST_SERVICE_DESCRIPTION,
  fstFaqItems,
} from "@shared/free-smart-terminal-content";

const eligibilityItems = [
  "New merchant opening a processing account with Liberty Bancard",
  "Monthly card volume of $5,000 or more",
  "Not under an existing equipment lease or locked-in contract",
  "Approved underwriting — standard qualification applies",
];

const terminalFeatures = [
  { icon: Wifi, label: "Tap, chip & swipe", desc: "Accepts all major card types and contactless payments" },
  { icon: CreditCard, label: "Dual-price ready", desc: "Pre-configured for cash discount or standard processing" },
  { icon: Zap, label: "Fast setup", desc: "Configured, shipped, and supported by a real person" },
  { icon: Monitor, label: "Clear receipts", desc: "Compliant receipts with dual-pricing disclosure built in" },
];


export default function FreeSmartTerminal() {
  const containerRef = useScrollReveal();

  return (
    <div className="min-h-screen flex flex-col font-body pb-[72px] md:pb-0">
      <SEO
        title={FST_TITLE}
        description={FST_DESCRIPTION}
        path={FST_PATH}
        keywords={FST_KEYWORDS}
        breadcrumbs={[{ name: "Free Smart Terminal", path: FST_PATH }]}
        structuredData={[
          getServiceSchema(FST_SERVICE_NAME, FST_SERVICE_DESCRIPTION, FST_PATH),
          getFAQSchema(fstFaqItems),
        ]}
      />
      <Navbar />

      <main className="marketing-surface flex-grow pt-28" ref={containerRef}>
        {/* Hero */}
        <section className="marketing-surface relative overflow-hidden bg-background border-b border-border" data-testid="section-terminal-hero">
          <div className="pointer-events-none absolute inset-0 ledger-texture opacity-[0.5]" aria-hidden="true" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div className="accent-rule pt-5">
                <div className="inline-flex items-center gap-2 border border-border bg-card text-muted-foreground text-sm font-semibold px-3 py-1.5 rounded-md mb-6 shadow-sm" data-testid="badge-terminal-hero">
                  <Monitor className="w-4 h-4 text-accent" />
                  Smart Terminal Program
                </div>
                <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground leading-tight mb-6" data-testid="text-terminal-hero-heading">
                  See If Your Business Qualifies for a Smart Terminal at No Upfront Cost.
                </h1>
                <p className="text-lg text-muted-foreground mb-4 leading-relaxed" data-testid="text-terminal-hero-sub">
                  Qualifying merchants who open a Liberty Bancard processing account may receive terminal placement with no purchase cost. We review your statement to confirm eligibility — no guesswork, no pressure.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap mb-3">
                  <Link
                    href="/get-started?offer=free-terminal"
                    data-testid="link-terminal-primary-cta"
                    onClick={() => trackFreeTerminalEligibilityClick({ page: "/free-smart-terminal", ctaLabel: "Check My Eligibility", offer: "free-terminal" })}
                  >
                    <Button size="lg" className="gap-2">
                      <Upload className="w-4 h-4" />
                      Check My Eligibility — Free
                    </Button>
                  </Link>
                  <a
                    href={CALENDAR_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="link-terminal-book-cta"
                    onClick={() => trackBookingCtaClick({ page: "/free-smart-terminal", ctaLabel: "Book a 10-Min Call" })}
                  >
                    <Button size="lg" variant="outline" className="gap-2">
                      <Calendar className="w-4 h-4" />
                      Book a 10-Min Call
                    </Button>
                  </a>
                </div>
                <p className="text-xs text-muted-foreground/80 mt-2 max-w-lg" data-testid="text-terminal-hero-disclaimer">
                  Terminal placement subject to account approval, underwriting, minimum volume requirements, and eligibility review. Not a guaranteed offer.
                </p>
              </div>
              <div className="flex flex-col gap-4 items-center">
                <img
                  src={imgCloverFlex3}
                  alt="Clover Flex 3 smart payment terminal"
                  className="w-full max-w-xs rounded-md object-contain"
                  data-testid="img-terminal-clover"
                />
                <img
                  src={imgPaxA920}
                  alt="PAX A920 smart payment terminal"
                  className="w-full max-w-xs rounded-md object-cover"
                  data-testid="img-terminal-pax"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Trust strip */}
        <div className="bg-muted/50 border-b border-border py-3" data-testid="section-trust-strip">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Eligibility confirmed via statement review</span>
              <span className="flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-sky-500" /> No upfront purchase cost for qualifying merchants</span>
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-primary" /> Setup in as little as 48 hours</span>
              <span className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-primary" /> No long-term processing contract</span>
            </div>
          </div>
        </div>

        {/* Terminal features */}
        <section className="bg-muted/30 py-20" data-testid="section-terminal-features">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-features-heading">
                What's Included with Terminal Placement
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Every terminal is configured for your business type — cash discount or standard pricing — with compliant receipts and go-live support built in.
              </p>
            </div>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {terminalFeatures.map((feature, i) => {
                const Icon = feature.icon;
                return (
                  <Card key={i} data-testid={`card-feature-${i}`}>
                    <CardContent className="p-6">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="font-display font-bold text-foreground mb-1">{feature.label}</h3>
                      <p className="text-sm text-muted-foreground">{feature.desc}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Eligibility */}
        <section className="bg-background py-20" data-testid="section-eligibility">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
              <div>
                <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-eligibility-heading">
                  Who Typically Qualifies
                </h2>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  Terminal placement is available for qualifying merchants opening a Liberty Bancard processing account. We confirm eligibility by reviewing your processing statement — no guesswork required.
                </p>
                <ul className="space-y-3 mb-6">
                  {eligibilityItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-3" data-testid={`eligibility-item-${i}`}>
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                      <span className="text-muted-foreground text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-md p-4 flex gap-3 mb-6">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    Terminal placement is not a guaranteed offer for all merchants. Eligibility depends on account approval, underwriting, card volume, and business type. We confirm details during your free statement review.
                  </p>
                </div>
                <Link
                  href="/upload-statement?offer=free-terminal"
                  data-testid="link-eligibility-upload"
                  onClick={() => trackStatementUploadCtaClick({ page: "/free-smart-terminal", ctaLabel: "Upload Statement to Check Eligibility", offer: "free-terminal" })}
                >
                  <Button className="gap-2">
                    <Upload className="w-4 h-4" />
                    Upload Statement to Check Eligibility
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
              <div>
                <Card className="border-primary/20 bg-primary/5" data-testid="card-terminal-cta">
                  <CardContent className="p-6 text-center">
                    <Monitor className="w-10 h-10 text-primary mx-auto mb-4" />
                    <h3 className="text-xl font-display font-bold text-foreground mb-2">
                      Not Sure If You Qualify?
                    </h3>
                    <p className="text-muted-foreground text-sm mb-6">
                      Upload your most recent processing statement. We'll review your card volume, current setup, and equipment situation — then confirm eligibility and show your savings potential.
                    </p>
                    <div className="flex flex-col gap-3">
                      <Link
                        href="/upload-statement?offer=free-terminal"
                        data-testid="link-cta-card-upload"
                        onClick={() => trackFreeTerminalEligibilityClick({ page: "/free-smart-terminal", ctaLabel: "Check My Eligibility", ctaLocation: "card" })}
                      >
                        <Button className="w-full gap-2">
                          <Upload className="w-4 h-4" />
                          Check My Eligibility
                        </Button>
                      </Link>
                      <a
                        href={PHONE_TEL}
                        aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`}
                        data-testid="link-cta-card-phone"
                        onClick={() => trackPhoneCallClick({ sourcePage: "/free-smart-terminal" })}
                      >
                        <Button variant="outline" className="w-full gap-2">
                          <Phone className="w-4 h-4" />
                          {PHONE_NUMBER}
                        </Button>
                      </a>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-muted/30 py-20" data-testid="section-how-it-works">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-12">
              <h2 className="text-3xl font-display font-bold text-foreground mb-4" data-testid="text-howitworks-heading">
                How Terminal Placement Works
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                From statement upload to processing live — here's the typical path.
              </p>
            </div>
            <div className="reveal grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { step: "1", title: "Upload Your Statement", desc: "PDF or photo. We only need totals and fee lines. Redact account numbers if you prefer." },
                { step: "2", title: "Eligibility Review", desc: "We review your volume, setup, and current equipment situation same business day." },
                { step: "3", title: "Account Approval", desc: "If you qualify, we set up your processing account and confirm terminal placement details." },
                { step: "4", title: "Terminal Shipped", desc: "Pre-configured terminal shipped to you. Go-live support included. Live in as little as 48 hours." },
              ].map((item, i) => (
                <div key={i} className="text-center" data-testid={`step-terminal-${i}`}>
                  <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-4 text-lg font-bold">
                    {item.step}
                  </div>
                  <h3 className="font-display font-bold text-foreground mb-2 text-sm">{item.title}</h3>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-background py-20" data-testid="section-faq">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-10">
              <h2 className="text-3xl font-display font-bold text-foreground mb-4" data-testid="text-faq-heading">
                Frequently Asked Questions
              </h2>
            </div>
            <div className="reveal">
              <Accordion type="single" collapsible className="space-y-2">
                {fstFaqItems.map((item, i) => (
                  <AccordionItem key={i} value={`faq-${i}`} className="border border-border rounded-md px-4" data-testid={`faq-item-${i}`}>
                    <AccordionTrigger className="text-left font-semibold text-sm py-4">
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground text-sm pb-4">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden bg-primary py-20" data-testid="section-final-cta">
          <div className="pointer-events-none absolute inset-0 ledger-texture opacity-[0.06]" aria-hidden="true" />
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent" aria-hidden="true" />
          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-primary-foreground mb-4" data-testid="text-final-cta-heading">
              Find Out If You Qualify
            </h2>
            <p className="text-primary-foreground/80 mb-8 leading-relaxed">
              Upload your statement and we'll review your eligibility — same business day. Free. No obligation. You keep the breakdown either way.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link
                href="/upload-statement?offer=free-terminal"
                data-testid="link-final-upload"
                onClick={() => trackFreeTerminalEligibilityClick({ page: "/free-smart-terminal", ctaLabel: "Upload My Statement", ctaLocation: "final_cta" })}
              >
                <Button size="lg" className="gap-2 bg-accent hover:bg-accent border-accent text-white">
                  <Upload className="w-4 h-4" />
                  Upload My Statement
                </Button>
              </Link>
              <a
                href={CALENDAR_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-final-book"
                onClick={() => trackBookingCtaClick({ page: "/free-smart-terminal", ctaLabel: "Book a 10-Min Call", ctaLocation: "final_cta" })}
              >
                <Button size="lg" variant="outline" className="gap-2 bg-transparent border-white/30 text-white hover:bg-white/10">
                  <Calendar className="w-4 h-4" />
                  Book a 10-Min Call
                </Button>
              </a>
              <a
                href={PHONE_TEL}
                aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`}
                data-testid="link-final-phone"
                onClick={() => trackPhoneCallClick({ sourcePage: "/free-smart-terminal" })}
              >
                <Button size="lg" variant="ghost" className="gap-2 text-white hover:bg-white/10">
                  <Phone className="w-4 h-4" />
                  {PHONE_NUMBER}
                </Button>
              </a>
            </div>
            <p className="text-primary-foreground/50 text-xs mt-6">
              Terminal placement available for qualifying merchants. Subject to account approval, underwriting, and minimum volume requirements.
            </p>
          </div>
        </section>

        {/* Internal navigation links — crawlable */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 border-t border-border" data-testid="section-internal-links">
          <p className="text-sm text-muted-foreground mb-3 font-medium">Also useful:</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/upload-statement" className="text-primary hover:underline" data-testid="link-internal-upload-statement">
              Upload Your Statement for a Free Review
            </Link>
            <Link href="/free-analysis" className="text-primary hover:underline" data-testid="link-internal-free-analysis">
              Get a Free Processing Analysis
            </Link>
            <Link href="/industries/restaurant-payment-processing" className="text-primary hover:underline" data-testid="link-internal-industry-restaurant">
              Restaurant Payment Processing
            </Link>
            <Link href="/industries/retail-payment-processing" className="text-primary hover:underline" data-testid="link-internal-industry-retail">
              Retail Payment Processing
            </Link>
            <Link href="/industries/healthcare-payment-processing" className="text-primary hover:underline" data-testid="link-internal-industry-healthcare">
              Healthcare Payment Processing
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
