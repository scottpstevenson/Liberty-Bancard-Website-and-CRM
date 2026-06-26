import { useEffect, useState } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  Gift,
  Shield,
  ShieldCheck,
  FileText,
  BarChart3,
  Star,
  Upload,
  Clock,
  ChevronDown,
  ChevronUp,
  Lock,
  Award,
  TrendingUp,
  Users,
  Zap,
  ArrowRight,
  Phone,
} from "lucide-react";

const faqItems = [
  {
    q: "What exactly is the $50 guarantee?",
    a: "If we review your statement and cannot identify at least one verifiable savings opportunity, we'll send you a $50 Amazon gift card — no questions asked. We've reviewed 3,200+ statements and have only paid out a handful of gift cards. Most merchants save significantly more.",
  },
  {
    q: "Is there any obligation to switch processors?",
    a: "None. Zero. You get the full written analysis and benchmark report regardless of what you decide. We show you the numbers — you decide what to do with them. We earn your business by proving value, not by locking you in.",
  },
  {
    q: "Do I need to schedule a sales call?",
    a: "No sales call required. Upload your statement, we analyze it, and we send you the written report. If you want to talk through the numbers, we're available — but it's never a requirement.",
  },
  {
    q: "What information do you need from my statement?",
    a: "We only need the fee and volume totals — not your merchant account number or banking info. You can redact any sensitive numbers before uploading. A PDF or photo of your statement works perfectly.",
  },
  {
    q: "How long does the analysis take?",
    a: "We deliver your written savings summary within 24 business hours. Most analyses are completed the same day during business hours (Monday–Friday, 9am–6pm ET).",
  },
];

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="py-16 bg-background" data-testid="section-faq">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-foreground text-center mb-3">
          Frequently Asked Questions
        </h2>
        <p className="text-muted-foreground text-center mb-10">
          Everything you need to know before you upload.
        </p>
        <div className="space-y-2">
          {faqItems.map((item, idx) => (
            <Card key={idx} data-testid={`card-faq-${idx}`} className="overflow-hidden">
              <CardContent className="p-0">
                <button
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setOpen(open === idx ? null : idx)}
                  data-testid={`button-faq-toggle-${idx}`}
                  aria-expanded={open === idx}
                >
                  <span className="text-sm font-semibold text-foreground pr-4">{item.q}</span>
                  {open === idx ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </button>
                {open === idx && (
                  <div className="px-5 pb-5">
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.a,
    },
  })),
};

const serviceJsonLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "Free Merchant Statement Analysis — Guaranteed Savings",
  description:
    "Upload your merchant processing statement and we'll find your hidden fees, benchmark you against 3,200+ statements, and show you exactly what you should be paying. If we can't find you savings, we send you a $50 gift card.",
  provider: {
    "@type": "Organization",
    name: "Liberty Bancard",
    url: "https://libertybancard.com",
  },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free statement analysis — $50 gift card guarantee if no savings found",
  },
};

export default function FreeAnalysisGuaranteed() {
  const [uploadHref, setUploadHref] = useState("/upload-statement");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    const utmPairs: string[] = [];
    utmKeys.forEach((key) => {
      const val = params.get(key);
      if (val) utmPairs.push(`${key}=${encodeURIComponent(val)}`);
    });
    if (utmPairs.length > 0) {
      setUploadHref(`/upload-statement?${utmPairs.join("&")}`);
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="Free Statement Analysis — Guaranteed Savings | Liberty Bancard"
        description="Upload your statement and we'll find hidden fees, benchmark you against 3,200+ statements, and show exactly what you should pay. No savings? We'll send you a $50 gift card."
        path="/free-analysis-guaranteed"
        keywords="free merchant statement analysis, guaranteed savings, payment processing review, hidden fees, merchant services benchmark"
        structuredData={[faqJsonLd, serviceJsonLd]}
      />
      <Navbar />

      <main className="marketing-surface flex-grow pt-20">
        {/* ── Hero ── */}
        <section
          className="marketing-surface relative overflow-hidden bg-background border-b border-border py-20 lg:py-28"
          data-testid="section-hero"
        >
          <div className="pointer-events-none absolute inset-0 ledger-texture opacity-[0.5]" aria-hidden="true" />

          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="accent-rule pt-5">
            <Badge
              className="mb-5 border border-border bg-card text-muted-foreground shadow-sm text-sm font-medium"
              data-testid="badge-guarantee-label"
            >
              <Gift className="w-4 h-4 mr-1.5" />
              100% Risk-Free Guarantee
            </Badge>

            <h1
              className="text-3xl sm:text-4xl lg:text-5xl font-display font-extrabold leading-tight mb-5 text-foreground"
              data-testid="text-hero-headline"
            >
              If We Can't Save You Money,{" "}
              <span className="text-emerald-600 dark:text-emerald-400">We'll Pay You $50</span>
            </h1>

            <p
              className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed"
              data-testid="text-hero-subheadline"
            >
              Upload your processing statement and we'll find your hidden fees, benchmark you against
              3,200+ real merchant statements, and deliver a written savings report within 24 hours.
              No sales call required. No obligation.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-10">
              <Link href={uploadHref} data-testid="button-hero-cta">
                <Button size="lg" className="font-semibold">
                  <Upload className="w-5 h-5 mr-2" />
                  Get My Free Analysis
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <a href="tel:9542668214" data-testid="link-hero-phone">
                <Button variant="outline" size="lg">
                  <Phone className="w-4 h-4 mr-2" />
                  Call 954-266-8214
                </Button>
              </a>
            </div>

            <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5" data-testid="text-trust-nocall">
                <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                No sales call required
              </span>
              <span className="flex items-center gap-1.5" data-testid="text-trust-nocc">
                <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                No credit card
              </span>
              <span className="flex items-center gap-1.5" data-testid="text-trust-noobligation">
                <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                No obligation
              </span>
              <span className="flex items-center gap-1.5" data-testid="text-trust-24hr">
                <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                24-hour turnaround
              </span>
            </div>
            </div>
          </div>
        </section>

        {/* ── Guarantee Box ── */}
        <section className="py-12 bg-muted/40" data-testid="section-guarantee">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <Card
              className="border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20 shadow-lg"
              data-testid="card-guarantee"
            >
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                  <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                    <Gift className="w-7 h-7 text-white" />
                  </div>
                  <div className="flex-1">
                    <h2
                      className="text-xl font-display font-bold text-foreground mb-2"
                      data-testid="text-guarantee-headline"
                    >
                      Our Savings Guarantee
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                      We've reviewed over 3,200 merchant statements. Every single one had at least one
                      identifiable savings opportunity. But if we review yours and genuinely cannot
                      find a way to save you money, we'll send you a <strong>$50 Amazon gift
                      card</strong> — just for your time.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        "Find savings in 24 hours or $50 gift card",
                        "No sales call required",
                        "No obligation to switch",
                        "No credit card needed",
                      ].map((item) => (
                        <div
                          key={item}
                          className="flex items-center gap-2 text-sm text-foreground"
                          data-testid={`text-guarantee-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                        >
                          <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── Social Proof Bar ── */}
        <section
          className="relative overflow-hidden bg-primary text-primary-foreground py-10"
          data-testid="section-social-proof"
        >
          <div className="pointer-events-none absolute inset-0 ledger-texture opacity-[0.06]" aria-hidden="true" />
          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
              <div data-testid="stat-statements-reviewed">
                <div className="num text-4xl font-display font-bold text-emerald-400 mb-1">3,200+</div>
                <div className="text-sm text-white/65">Statements Reviewed</div>
              </div>
              <div data-testid="stat-avg-savings">
                <div className="num text-4xl font-display font-bold text-emerald-400 mb-1">$2,847</div>
                <div className="text-sm text-white/65">Average Monthly Savings Found</div>
              </div>
              <div data-testid="stat-rating">
                <div className="flex justify-center items-baseline gap-1 mb-1">
                  <span className="num text-4xl font-display font-bold text-emerald-400">4.9</span>
                  <span className="num text-2xl font-bold text-emerald-400">/5</span>
                </div>
                <div className="flex justify-center gap-0.5 mb-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <div className="text-sm text-white/65">Average Merchant Rating</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── What You Get ── */}
        <section className="py-16 bg-background" data-testid="section-what-you-get">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-foreground text-center mb-3">
              What You Get
            </h2>
            <p className="text-muted-foreground text-center max-w-xl mx-auto mb-10">
              Not a vague "consultation" — a real deliverable you keep, regardless of what you decide.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card
                className="border-border/50 hover:shadow-md transition-shadow"
                data-testid="card-what-breakdown"
              >
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center mb-4">
                    <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2">
                    Full Statement Breakdown in Plain English
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    We decode every line: interchange costs, processor markup, assessment fees, and
                    any junk fees you're being charged that have no business being there. Written so
                    your accountant can read it.
                  </p>
                </CardContent>
              </Card>

              <Card
                className="border-border/50 hover:shadow-md transition-shadow"
                data-testid="card-what-benchmark"
              >
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-950/40 flex items-center justify-center mb-4">
                    <BarChart3 className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2">
                    Benchmark Against 3,200+ Statements
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    We compare your effective rate and fee structure against businesses in your
                    industry and volume tier. You'll see exactly where you stand — and what the
                    best-in-class merchants in your category actually pay.
                  </p>
                </CardContent>
              </Card>

              <Card
                className="border-border/50 hover:shadow-md transition-shadow"
                data-testid="card-what-savings"
              >
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center mb-4">
                    <TrendingUp className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2">
                    Written Savings Summary You Can Share
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    A clear, one-page savings summary with your current effective rate, your target
                    rate, and estimated annual savings — formatted so you can share it with your
                    accountant, business partner, or board. It's yours to keep.
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="text-center mt-10">
              <Link href={uploadHref} data-testid="button-what-cta">
                <Button
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Get My Free Analysis Now
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section className="py-16 bg-muted/40" data-testid="section-how-it-works">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-foreground text-center mb-3">
              How It Works
            </h2>
            <p className="text-muted-foreground text-center max-w-xl mx-auto mb-12">
              Three steps. Under 5 minutes on your end.
            </p>

            <div className="relative">
              <div className="hidden md:block absolute top-8 left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] h-0.5 bg-border" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  {
                    step: "1",
                    icon: Upload,
                    title: "Upload Your Statement",
                    desc: "Securely upload your most recent processing statement — PDF or photo. Redact account numbers if you prefer. We only need the fee and volume totals.",
                    testid: "step-upload",
                  },
                  {
                    step: "2",
                    icon: BarChart3,
                    title: "We Analyze in 24 Hours",
                    desc: "Our team reviews every line item, benchmarks your costs against industry peers, and builds your personalized written savings report.",
                    testid: "step-analyze",
                  },
                  {
                    step: "3",
                    icon: FileText,
                    title: "Receive Your Report",
                    desc: "You receive a written savings summary via email — with your current rate, your target rate, and estimated annual savings. No strings attached.",
                    testid: "step-report",
                  },
                ].map(({ step, icon: Icon, title, desc, testid }) => (
                  <div
                    key={step}
                    className="flex flex-col items-center text-center"
                    data-testid={`card-${testid}`}
                  >
                    <div className="relative w-16 h-16 rounded-full bg-primary flex items-center justify-center mb-5 shadow-lg z-10">
                      <Icon className="w-7 h-7 text-primary-foreground" />
                      <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold">
                        {step}
                      </div>
                    </div>
                    <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Trust Signals ── */}
        <section className="py-12 border-y border-border bg-background" data-testid="section-trust">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest text-center mb-8">
              Industry Standards We Uphold
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  icon: ShieldCheck,
                  label: "PCI DSS Compliant",
                  sub: "Level 1 certified",
                  color: "text-blue-600 dark:text-blue-400",
                  bg: "bg-blue-50 dark:bg-blue-950/30",
                  testid: "badge-pci",
                },
                {
                  icon: Lock,
                  label: "SSL Encrypted",
                  sub: "256-bit encryption",
                  color: "text-green-600 dark:text-green-400",
                  bg: "bg-green-50 dark:bg-green-950/30",
                  testid: "badge-ssl",
                },
                {
                  icon: Award,
                  label: "BBB Accredited",
                  sub: "A+ rating",
                  color: "text-amber-600 dark:text-amber-400",
                  bg: "bg-amber-50 dark:bg-amber-950/30",
                  testid: "badge-bbb",
                },
                {
                  icon: Zap,
                  label: "No Contract Required",
                  sub: "Month-to-month",
                  color: "text-purple-600 dark:text-purple-400",
                  bg: "bg-purple-50 dark:bg-purple-950/30",
                  testid: "badge-nocontract",
                },
              ].map(({ icon: Icon, label, sub, color, bg, testid }) => (
                <Card
                  key={label}
                  className="border-border/50"
                  data-testid={testid}
                >
                  <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                    <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground">{sub}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <FaqSection />

        {/* ── Final CTA ── */}
        <section
          className="relative overflow-hidden py-16 bg-primary text-primary-foreground"
          data-testid="section-final-cta"
        >
          <div className="pointer-events-none absolute inset-0 ledger-texture opacity-[0.06]" aria-hidden="true" />
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent" aria-hidden="true" />
          <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-6">
              <Gift className="w-7 h-7 text-emerald-400" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-4 text-white">
              Not Signing Up Feels Irrational
            </h2>
            <p className="text-white/70 mb-8 leading-relaxed">
              Either we find you savings — which most merchants use to reduce costs or reinvest in
              their business — or we pay you $50 for your time. There's no scenario where you lose.
            </p>
            <Link href={uploadHref} data-testid="button-final-cta">
              <Button
                size="lg"
                className="bg-emerald-500 border-emerald-500 text-white font-semibold"
              >
                <Upload className="w-5 h-5 mr-2" />
                Upload My Statement — It's Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <p className="text-white/50 text-xs mt-4">
              Secure upload · 24-hour turnaround · No sales pressure · $50 guarantee if no savings found
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
