import { useState } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
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
    desc: "Mention to any business client that you can connect them with a free, no-obligation processing review. That's it — no sales pitch needed from you.",
  },
  {
    num: "02",
    title: "We Do the Analysis",
    desc: "Liberty Bancard reviews their current statement, identifies overpayments, and presents a clear savings breakdown. Our team handles everything.",
  },
  {
    num: "03",
    title: "You Earn Every Month",
    desc: "When your client activates, you earn 30% of Liberty's net processing revenue — every month, for the life of the account.",
  },
];

const benefits = [
  {
    icon: FileText,
    title: "No Sales Effort Required",
    desc: "You make the introduction. Liberty Bancard's team handles the review, proposal, and onboarding. Your job ends at the referral.",
  },
  {
    icon: DollarSign,
    title: "30% Lifetime Residual",
    desc: "Earn a share of net processing revenue every month your client is active. A single client referral can pay residuals for years.",
  },
  {
    icon: Shield,
    title: "Fully Compliant",
    desc: "Referring clients to a payment processor is not a securities or advisory service. Our compliance team can provide a simple disclosure for your client files.",
  },
  {
    icon: Users,
    title: "Your Clients Already Ask",
    desc: "Processing fees are often the second-largest cost after payroll for small businesses. This is a service your clients are already looking for.",
  },
  {
    icon: Clock,
    title: "Monthly Residual Payments",
    desc: "Commissions are calculated at month-end and paid promptly. You'll have full visibility in your partner portal.",
  },
  {
    icon: TrendingUp,
    title: "No Volume Minimums",
    desc: "Refer one client or fifty. There's no minimum to qualify for residuals — every activated merchant counts.",
  },
];

const faqs = [
  {
    q: "Is referring clients to a payment processor considered an endorsement?",
    a: "Referring a business owner to Liberty Bancard is a business referral, not a financial product endorsement. We recommend reviewing with your state CPA board, but most CPAs treat this as they would any professional referral. We can provide a sample disclosure letter for your client files.",
  },
  {
    q: "How do I explain this to my clients without sounding sales-y?",
    a: "The easiest framing: 'I reviewed your financials and noticed your processing fees seem high. I work with a processor that does free statement reviews — it could save you thousands. Want me to connect you?' That's it. No pitch. We handle the rest.",
  },
  {
    q: "When do I get paid?",
    a: "Residuals are calculated at the end of each processing month and paid within 15 days of close. You'll receive a detailed statement in your partner portal showing merchant-level breakdowns.",
  },
  {
    q: "What if my client has a long-term contract with their current processor?",
    a: "Liberty Bancard will review their statement and provide a savings projection. If the savings justify switching, we help them understand their exit options. We never pressure a client to break a contract that isn't in their interest.",
  },
  {
    q: "Do I need to disclose this to my clients?",
    a: "Transparency is always best practice. A simple disclosure — 'I may receive a referral fee if you choose to work with Liberty Bancard' — is sufficient in most jurisdictions. We'll provide a sample disclosure template when you apply.",
  },
  {
    q: "What kinds of businesses are the best referrals?",
    a: "Any business that accepts credit cards and processes more than $5,000/month. Best fits: restaurants, retail shops, healthcare practices, salons, contractors, and professional service firms.",
  },
];

function CpaResidualCalculator() {
  const [clients, setClients] = useState(5);
  const [avgVolume, setAvgVolume] = useState(25000);

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
          <p className="text-sm text-muted-foreground">Estimate your monthly passive income from client referrals</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Number of Clients to Refer
          </label>
          <Input
            type="number"
            min={1}
            max={200}
            value={clients}
            onChange={e => setClients(Math.max(1, Number(e.target.value)))}
            data-testid="input-cpa-clients"
          />
          <p className="text-xs text-muted-foreground mt-1">How many business clients you'd refer initially</p>
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
            data-testid="input-cpa-volume"
          />
          <p className="text-xs text-muted-foreground mt-1">Typical monthly credit card sales per business</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-background rounded-xl border border-border p-5 text-center">
          <p className="text-sm text-muted-foreground mb-1">Estimated Monthly Residual</p>
          <p className="text-3xl font-bold text-primary" data-testid="text-cpa-monthly">
            ${monthlyResidual.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">per month</p>
        </div>
        <div className="bg-background rounded-xl border border-border p-5 text-center">
          <p className="text-sm text-muted-foreground mb-1">Estimated Annual Residual</p>
          <p className="text-3xl font-bold text-green-600" data-testid="text-cpa-annual">
            ${annualResidual.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">per year</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-4 text-center">
        Estimates based on ~30 bps net processing revenue at 30% CPA partner share. Actual results vary by merchant mix and volume. Contact us for a personalized projection.
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
        data-testid={`faq-toggle-${q.slice(0, 20).replace(/\s/g, "-").toLowerCase()}`}
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

export default function PartnerCPA() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="CPA Partner Program — Earn Residuals | Liberty Bancard"
        description="CPAs: your clients are overpaying on processing fees. Refer them to Liberty Bancard and earn 30% lifetime residual income. No sales effort — just a referral."
        path="/partners/cpa"
      />
      <Navbar />
      <main className="flex-grow pt-28">

        {/* Hero */}
        <section className="bg-gradient-to-br from-primary/5 via-background to-background py-16 md:py-24 border-b border-border/30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
                CPA Partner Program
              </Badge>
              <h1 className="text-3xl md:text-5xl font-display font-bold text-foreground leading-tight mb-6">
                Your Clients Are Asking About Processing Fees. Here's How to Help Them — and Earn a Residual Income Doing It.
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8">
                Processing fees are often the largest overlooked cost on your clients' P&Ls. You already review their financials — now you can do something about it, at no effort to you, and earn 30% lifetime residual income on every client you refer.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/partners#apply">
                  <Button size="lg" className="gap-2 w-full sm:w-auto" data-testid="button-cpa-hero-apply">
                    Apply as a CPA Partner <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <a href="#calculator">
                  <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto" data-testid="button-cpa-hero-calculator">
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
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">$0</p>
                <p className="text-sm text-muted-foreground">effort after the introduction</p>
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">24 hr</p>
                <p className="text-sm text-muted-foreground">partner approval turnaround</p>
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">Monthly</p>
                <p className="text-sm text-muted-foreground">residual payments</p>
              </div>
            </div>
          </div>
        </section>

        {/* Why CPAs */}
        <section className="py-16 md:py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4">
                  You're Already Looking at the Numbers
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  When you review a client's P&L or bank statements, processing fees are right there — often $500 to $5,000+ per month in a line item that most business owners accept as unavoidable. It's not. Liberty Bancard's free statement review regularly finds 20–40% in hidden overcharges.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  You don't need to pitch anything. You already have the trust. A single sentence — "I work with a processor that does free reviews, want me to connect you?" — is all it takes.
                </p>
                <div className="space-y-3">
                  {["Processing fees are often 1–3% of gross revenue — a significant P&L line", "Most merchants are on outdated pricing models with hidden markups", "A free statement review is a high-value service your clients will thank you for", "You earn 30% of net revenue every month — no ongoing effort required"].map(point => (
                    <div key={point} className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                      <span className="text-sm text-foreground leading-relaxed">{point}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-muted/30 border border-border/40 rounded-2xl p-8">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Example</p>
                <p className="text-foreground leading-relaxed mb-4">
                  A restaurant client processes <strong>$80,000/month</strong> in card sales. Their current processor charges an effective rate of 3.1%. Liberty Bancard brings that to 2.4% — saving them <strong>$560/month</strong>.
                </p>
                <p className="text-foreground leading-relaxed mb-6">
                  Your 30% residual share: <strong className="text-primary">~$75–$90/month from one referral</strong>, every month they stay active.
                </p>
                <p className="text-muted-foreground text-sm">
                  A portfolio of 10 clients like this generates <strong>$750–$900/month</strong> in passive income — for introductions you made in the flow of normal client conversations.
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
                Three steps from introduction to residual income. We do the heavy lifting.
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
                Why CPAs Choose Liberty Bancard
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                A referral program built around how CPAs actually work — relationship-first, effort-minimal.
              </p>
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
                How Much Could You Earn?
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Enter the number of business clients you'd refer and their typical monthly card volume to see your estimated residual income.
              </p>
            </div>
            <CpaResidualCalculator />
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 md:py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4">
                Frequently Asked Questions
              </h2>
              <p className="text-muted-foreground">
                Questions CPAs typically ask before joining the program.
              </p>
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
              Ready to Add Passive Income to Your Practice?
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Apply as a CPA Partner today. We'll review your application within 1 business day and get you set up with a referral link and client disclosure template.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/partners#apply">
                <Button size="lg" variant="secondary" className="gap-2 w-full sm:w-auto" data-testid="button-cpa-cta-apply">
                  Apply as a CPA Partner <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/partners">
                <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10" data-testid="button-cpa-cta-full-program">
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
