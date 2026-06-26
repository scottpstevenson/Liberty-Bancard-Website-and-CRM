import { useState } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Calculator, CheckCircle, ArrowRight, ChevronDown, ChevronUp,
  DollarSign, FileText, Users, Clock, Shield, TrendingUp, Handshake,
} from "lucide-react";

const howItWorks = [
  {
    num: "01",
    title: "Refer a Client",
    desc: "You already reconcile their statements every month — you see the fees firsthand. A simple introduction is all that's needed. 'I work with a processor that can review this' is a complete sentence.",
  },
  {
    num: "02",
    title: "We Do the Analysis",
    desc: "Liberty Bancard pulls apart the processing statement line by line and delivers a plain-English savings report. We handle the merchant conversation from start to finish.",
  },
  {
    num: "03",
    title: "You Earn Every Month",
    desc: "Once your client activates, you earn 30% of Liberty's net processing revenue — recurring, automatic, and reported in your partner portal.",
  },
];

const benefits = [
  {
    icon: FileText,
    title: "You Already See the Fees",
    desc: "Every month you reconcile statements and see exactly what merchants pay in processing costs. You have the context no one else does — and now you can do something about it.",
  },
  {
    icon: DollarSign,
    title: "30% Lifetime Residual",
    desc: "Earn 30% of Liberty's net processing revenue for as long as your client stays active. No clawbacks, no volume minimums.",
  },
  {
    icon: Shield,
    title: "Trusted Advisor Advantage",
    desc: "Business owners trust their bookkeeper. A referral from you carries more weight than any cold outreach — and saves your clients real money.",
  },
  {
    icon: Users,
    title: "Perfect Referral Timing",
    desc: "You know when a client is growing, adding locations, or switching systems. That's the ideal moment to introduce a processing review.",
  },
  {
    icon: Clock,
    title: "No Ongoing Work Required",
    desc: "The introduction is where your involvement ends. We do the analysis, the proposal, and the onboarding. Residuals keep flowing.",
  },
  {
    icon: TrendingUp,
    title: "Client Retention Benefit",
    desc: "Helping clients cut processing costs makes you a more valuable advisor. It's a reason to stay and a conversation that strengthens the relationship.",
  },
];

const faqs = [
  {
    q: "Don't I already see enough in their statements to know they're overpaying?",
    a: "You often can. But a full Liberty Bancard review goes deeper — identifying interchange downgrades, batch timing issues, mid-qual surcharges, and PCI non-compliance fees that appear as innocuous line items. We'll produce a report you can share with your client.",
  },
  {
    q: "Can I refer a client who's already locked in a contract?",
    a: "Yes. We'll review their statement and provide a savings projection. If the savings are significant, we'll walk them through their exit options. We never advise breaking a contract that doesn't make financial sense.",
  },
  {
    q: "How do I track my referrals?",
    a: "You'll get access to a partner portal with a personal referral link and tracking dashboard. Every merchant referred through your link is automatically attributed to you.",
  },
  {
    q: "How and when do I get paid?",
    a: "Residuals are calculated monthly and paid within 15 days of each processing month close. Your portal shows a detailed breakdown by merchant.",
  },
  {
    q: "What's the typical savings for a small business?",
    a: "Most small and mid-size businesses save between $200 and $1,500/month after switching. The savings depend on their volume, current rate, and whether they qualify for our cash discount or interchange-plus programs.",
  },
  {
    q: "Do I need to explain processing to my clients?",
    a: "Not at all. You can simply say: 'I noticed your processing fees and I work with a team that does free reviews — want me to send them your statement?' We take it from there.",
  },
];

function BookkeeperResidualCalculator() {
  const [clients, setClients] = useState(5);
  const [avgVolume, setAvgVolume] = useState(20000);

  const monthlyResidual = clients * avgVolume * 0.003 * 0.30;
  const annualResidual = monthlyResidual * 12;

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Calculator className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-foreground">Residual Income Estimator</h3>
          <p className="text-sm text-muted-foreground">See what a few client referrals are worth over time</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Clients You'd Refer
          </label>
          <Input
            type="number"
            min={1}
            max={200}
            value={clients}
            onChange={e => setClients(Math.max(1, Number(e.target.value)))}
            data-testid="input-bk-clients"
          />
          <p className="text-xs text-muted-foreground mt-1">Start with your top clients who process the most</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Avg Monthly Card Volume per Client ($)
          </label>
          <Input
            type="number"
            min={5000}
            max={500000}
            step={1000}
            value={avgVolume}
            onChange={e => setAvgVolume(Math.max(5000, Number(e.target.value)))}
            data-testid="input-bk-volume"
          />
          <p className="text-xs text-muted-foreground mt-1">Monthly credit card sales volume per business</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-background rounded-xl border border-border p-5 text-center">
          <p className="text-sm text-muted-foreground mb-1">Estimated Monthly Residual</p>
          <p className="text-3xl font-bold text-primary" data-testid="text-bk-monthly">
            ${monthlyResidual.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">per month</p>
        </div>
        <div className="bg-background rounded-xl border border-border p-5 text-center">
          <p className="text-sm text-muted-foreground mb-1">Estimated Annual Residual</p>
          <p className="text-3xl font-bold text-green-600" data-testid="text-bk-annual">
            ${annualResidual.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">per year</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-4 text-center">
        Estimates based on ~30 bps net processing revenue at 30% partner share. Actual results vary by merchant mix and volume.
      </p>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-5 text-left gap-4 hover:bg-muted/40 transition-colors"
        onClick={() => setOpen(o => !o)}
        data-testid={`faq-bk-toggle-${q.slice(0, 20).replace(/\s/g, "-").toLowerCase()}`}
        aria-expanded={open}
      >
        <span className="font-medium text-foreground text-sm leading-snug">{q}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5">
          <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  );
}

const bookkeeperFaqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map(item => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function PartnerBookkeeper() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Bookkeeper Partner Program — Earn 30% Residuals | Liberty Bancard"
        description="Bookkeepers: you see your clients' processing fees every month. Refer them to Liberty Bancard for a free statement review and earn 30% monthly residuals — no sales required."
        path="/partners/bookkeeper"
        keywords="bookkeeper referral income, bookkeeper partner program, merchant services referral, processing fee savings for clients"
        structuredData={[bookkeeperFaqJsonLd]}
      />
      <Navbar />
      <main className="flex-grow pt-28">

        {/* Hero */}
        <section className="bg-gradient-to-br from-primary/5 via-background to-background py-16 md:py-24 border-b border-border/30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
                Bookkeeper Partner Program
              </Badge>
              <h1 className="text-3xl md:text-5xl font-display font-bold text-foreground leading-tight mb-6">
                You Reconcile Their Statements Every Month. You Already Know They're Overpaying.
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8">
                Bookkeepers see processing fees every month — and most clients don't know what to do about them. Liberty Bancard's free statement review turns that observation into action, saves your clients real money, and pays you a 30% monthly residual for every referral that activates.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/partners#apply">
                  <Button size="lg" className="gap-2 w-full sm:w-auto" data-testid="button-bk-hero-apply">
                    Apply as a Bookkeeper Partner <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <a href="#calculator">
                  <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto" data-testid="button-bk-hero-calculator">
                    <Calculator className="w-4 h-4" /> Estimate My Income
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Trust Stats */}
        <section className="py-10 border-b border-border/30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
              <div>
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">30%</p>
                <p className="text-sm text-muted-foreground">lifetime residual share</p>
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">1 sentence</p>
                <p className="text-sm text-muted-foreground">is all the referral takes</p>
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">24 hr</p>
                <p className="text-sm text-muted-foreground">partner approval turnaround</p>
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">$0</p>
                <p className="text-sm text-muted-foreground">cost to join the program</p>
              </div>
            </div>
          </div>
        </section>

        {/* The Bookkeeper Advantage */}
        <section className="py-16 md:py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4">
                  The Bookkeeper's Unique Advantage
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-5">
                  No professional sees a business's financials as regularly as their bookkeeper. You know what they pay in processing fees, when those fees spike, and whether their current processor is being straight with them. That context is worth money.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  A typical small business pays $400–$2,000/month in processing fees. Liberty Bancard's review frequently identifies 20–40% in legitimate savings. When you make that introduction, you save your client real money — and earn a share of what they save every month going forward.
                </p>
                <div className="space-y-3">
                  {[
                    "You see the exact fees — you know who needs a review",
                    "Your clients trust your recommendations above all others",
                    "One referral conversation can produce years of passive income",
                    "No sales skills or payments knowledge required",
                  ].map(point => (
                    <div key={point} className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                      <span className="text-sm text-foreground leading-relaxed">{point}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-muted/30 border border-border/40 rounded-2xl p-8">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Real-World Scenario</p>
                <p className="text-foreground leading-relaxed mb-4">
                  A retail client processes <strong>$45,000/month</strong> in cards. During reconciliation, you notice their effective rate has crept up to 3.3% — that's $1,485/month in fees. Liberty Bancard brings it to 2.5%, saving them <strong>~$360/month</strong>.
                </p>
                <p className="text-foreground leading-relaxed mb-4">
                  Your monthly residual: <strong className="text-primary">~$40–$50/month from that one client</strong>, recurring.
                </p>
                <p className="text-muted-foreground text-sm">
                  Referring 8–10 clients like this produces <strong>$400–$600/month</strong> in passive income — conversations you were already having during reconciliation.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 md:py-20 bg-muted/30 border-y border-border/30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4">
                How It Works
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Three steps. You're done after step one.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {howItWorks.map((step) => (
                <div key={step.num} className="text-center">
                  <div className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold mx-auto mb-4">
                    {step.num}
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-16 md:py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4">
                What You Get as a Bookkeeper Partner
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {benefits.map((b) => {
                const Icon = b.icon;
                return (
                  <div key={b.title} className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">{b.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{b.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Calculator */}
        <section className="py-16 md:py-20 bg-muted/30 border-y border-border/30" id="calculator">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4">
                What Could Your Client Book Be Worth?
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Enter the number of business clients you'd refer and their typical monthly card volume.
              </p>
            </div>
            <BookkeeperResidualCalculator />
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 md:py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4">
                Frequently Asked Questions
              </h2>
            </div>
            <div className="space-y-2">
              {faqs.map((faq) => (
                <FaqItem key={faq.q} q={faq.q} a={faq.a} />
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 bg-primary text-primary-foreground">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Handshake className="w-10 h-10 mx-auto mb-4 opacity-80" />
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-3">
              Your Client Book Is Already a Portfolio
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Apply as a Bookkeeper Partner today. We'll approve your application within 1 business day and set you up with a referral link and client email template.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/partners#apply">
                <Button size="lg" variant="secondary" className="gap-2 w-full sm:w-auto" data-testid="button-bk-cta-apply">
                  Apply as a Bookkeeper Partner <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/partners">
                <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10" data-testid="button-bk-cta-full-program">
                  View Full Partner Program
                </Button>
              </Link>
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </div>
  );
}
