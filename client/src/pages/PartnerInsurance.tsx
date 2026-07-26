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
  DollarSign, MessageSquare, Users, Clock, Shield, TrendingUp, Handshake, Zap,
} from "lucide-react";

const howItWorks = [
  {
    num: "01",
    title: "Make the Introduction",
    desc: "During any business conversation, mention that you work with a processor that offers a free statement review. Cash discount programs in particular are a natural fit for any client worried about rising costs.",
  },
  {
    num: "02",
    title: "We Handle Everything",
    desc: "Liberty Bancard reviews their current processing costs, identifies savings, and presents the right program — cash discount, interchange-plus, or surcharging. Our team manages the full conversation.",
  },
  {
    num: "03",
    title: "You Earn Every Month",
    desc: "Once your client activates, you earn 30% of Liberty's net processing revenue — every single month for as long as they stay active.",
  },
];

const cashDiscountPoints = [
  {
    title: "Reduces the Cost Burden Your Clients Ask About",
    desc: "Small business owners frequently ask their insurance agent how to reduce overhead. Cash discount programs pass processing fees to card-paying customers — eliminating 80–100% of processing costs for the business.",
  },
  {
    title: "A Natural Conversation Starter",
    desc: "Any client who mentions tight margins, rising costs, or high overheads is a perfect referral. 'Have you looked at a cash discount program for your card processing?' opens the door without any sales pressure.",
  },
  {
    title: "Compliant in 48 States",
    desc: "Cash discount programs are legal and card-brand compliant in 48 US states when implemented correctly. Liberty Bancard handles all compliance configuration — your clients don't need to worry about the mechanics.",
  },
  {
    title: "Saves Real Money, Fast",
    desc: "Most businesses see processing fees drop to near-zero within 30 days of activation. That kind of immediate, visible savings builds lasting goodwill — and keeps your clients thinking of you as their most valuable advisor.",
  },
];

const benefits = [
  {
    icon: MessageSquare,
    title: "Perfect Conversation Starter",
    desc: "You already talk to every small business about protecting their assets. Payment cost reduction is a natural extension — especially when you can offer a free review with no obligation.",
  },
  {
    icon: DollarSign,
    title: "30% Lifetime Residual",
    desc: "Earn 30% of Liberty's net processing revenue every month. A portfolio of active merchants can generate hundreds or thousands per month in passive income.",
  },
  {
    icon: Zap,
    title: "Cash Discount Is the Hook",
    desc: "The cash discount program eliminates processing fees for the business entirely. It's an easy yes for cost-conscious owners — and a clean introduction that reflects well on you.",
  },
  {
    icon: Shield,
    title: "No Payments Expertise Needed",
    desc: "You don't need to know interchange categories or processor markup. Liberty Bancard explains everything to your client. Your job is the introduction.",
  },
  {
    icon: Users,
    title: "You See Every Small Business",
    desc: "Commercial and small business insurance puts you in front of the exact merchants who need payment processing — restaurants, contractors, retail, healthcare. Every prospect is a potential referral.",
  },
  {
    icon: Clock,
    title: "Monthly Residual Payments",
    desc: "Commissions are calculated at month-end and paid promptly. Your partner portal tracks every referred merchant and shows your earnings in real time.",
  },
];

const faqs = [
  {
    q: "How does a cash discount program work, exactly?",
    a: "A cash discount program posts a standard price for card-paying customers and a slightly lower price for cash payments — effectively passing the processing fee to card users. Liberty Bancard configures everything compliantly and provides the required signage and POS setup. Business owners see their processing fees drop to near zero.",
  },
  {
    q: "Is the cash discount program legal?",
    a: "Yes, in 48 US states. It is legal and fully compliant with Visa, Mastercard, Discover, and Amex rules when properly disclosed and configured. Liberty Bancard handles all compliance requirements.",
  },
  {
    q: "What kinds of businesses are the best referrals?",
    a: "Any small business that accepts credit cards and processes more than $5,000/month. Best fits for insurance agents: restaurants, retail shops, auto repair, contractors, healthcare practices, and service businesses. Essentially, your entire commercial and BOP book.",
  },
  {
    q: "How do I bring it up without it feeling salesy?",
    a: "Frame it around savings: 'One thing I've seen help businesses like yours is a program that eliminates card processing fees entirely. I work with a team that does free reviews — want me to connect you?' No pressure, no commitment, no expertise required from you.",
  },
  {
    q: "How do I track my referrals and income?",
    a: "You'll receive a unique referral link and access to a partner portal where you can see every referred merchant, their activation status, and your monthly residuals — broken down by merchant.",
  },
  {
    q: "Does this affect my E&O or professional liability?",
    a: "Business referrals of this type are generally not covered by professional liability policies — they are not insurance advice. As with any referral you make, simple transparency with your client ('I work with this processor and may receive a referral fee') is best practice.",
  },
];

function InsuranceResidualCalculator() {
  const [clients, setClients] = useState(8);
  const [avgVolume, setAvgVolume] = useState(30000);

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
          <p className="text-sm text-muted-foreground">Estimate your monthly passive income from business client referrals</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Business Clients to Refer
          </label>
          <Input
            type="number"
            min={1}
            max={200}
            value={clients}
            onChange={e => setClients(Math.max(1, Number(e.target.value)))}
            data-testid="input-ins-clients"
          />
          <p className="text-xs text-muted-foreground mt-1">From your commercial / small business book</p>
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
            data-testid="input-ins-volume"
          />
          <p className="text-xs text-muted-foreground mt-1">Monthly credit card sales volume per business</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-background rounded-xl border border-border p-5 text-center">
          <p className="text-sm text-muted-foreground mb-1">Estimated Monthly Residual</p>
          <p className="text-3xl font-bold text-primary" data-testid="text-ins-monthly">
            ${monthlyResidual.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">per month</p>
        </div>
        <div className="bg-background rounded-xl border border-border p-5 text-center">
          <p className="text-sm text-muted-foreground mb-1">Estimated Annual Residual</p>
          <p className="text-3xl font-bold text-green-600" data-testid="text-ins-annual">
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
        data-testid={`faq-ins-toggle-${q.slice(0, 20).replace(/\s/g, "-").toLowerCase()}`}
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

const insuranceFaqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map(item => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function PartnerInsurance() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title="Insurance Agent Partner Program — Earn 30% Residuals | Liberty Bancard"
        description="Insurance agents: your business clients are overpaying on card processing. Introduce them to Liberty Bancard's free review and earn 30% lifetime monthly residuals."
        path="/partners/insurance"
        keywords="insurance agent referral income, partner program for insurance agents, merchant services residuals, cash discount program referral"
        structuredData={[insuranceFaqJsonLd]}
      />
      <Navbar />
      <main className="flex-grow pt-28">

        {/* Hero */}
        <section className="bg-gradient-to-br from-primary/5 via-background to-background py-16 md:py-24 border-b border-border/30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
                Insurance Agent Partner Program
              </Badge>
              <h1 className="text-3xl md:text-5xl font-display font-bold text-foreground leading-tight mb-6">
                You Talk to Every Small Business. Here's How to Add Monthly Residual Income to Every Conversation.
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8">
                Insurance agents who serve small businesses are perfectly positioned to refer Liberty Bancard's cash discount and processing programs. Your clients want to reduce overhead — and eliminating processing fees is one of the fastest ways to do it. You earn 30% lifetime residuals for making the introduction.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/partners#apply">
                  <Button size="lg" className="gap-2 w-full sm:w-auto" data-testid="button-ins-hero-apply">
                    Apply as an Insurance Partner <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <a href="#calculator">
                  <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto" data-testid="button-ins-hero-calculator">
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
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">0%</p>
                <p className="text-sm text-muted-foreground">processing cost for your client (cash discount)</p>
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">24 hr</p>
                <p className="text-sm text-muted-foreground">partner approval turnaround</p>
              </div>
              <div>
                <p className="text-2xl md:text-3xl font-display font-bold text-primary">48 states</p>
                <p className="text-sm text-muted-foreground">cash discount compliance</p>
              </div>
            </div>
          </div>
        </section>

        {/* Cash Discount Section */}
        <section className="py-16 md:py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
                The Cash Discount Advantage
              </Badge>
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4">
                Cash Discount Programs: The Natural Conversation Starter for Insurance Agents
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                When small business owners want to cut costs, payment processing is one of the fastest levers — and cash discount programs can eliminate those fees entirely. As their insurance agent, you're in the perfect position to make that introduction.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {cashDiscountPoints.map((point) => (
                <div key={point.title} className="border border-border/60 rounded-xl p-6 bg-background">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">{point.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{point.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 bg-muted/30 border border-border/40 rounded-2xl p-6 md:p-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div>
                  <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">How to Bring It Up</p>
                  <div className="space-y-4">
                    <div className="bg-background border border-border/60 rounded-xl p-4">
                      <p className="text-xs text-muted-foreground mb-1">During a renewal conversation:</p>
                      <p className="text-sm text-foreground italic">"Besides your coverage, are there other costs you're trying to get under control? A lot of my restaurant clients have been eliminating their processing fees entirely with a program I can connect them to."</p>
                    </div>
                    <div className="bg-background border border-border/60 rounded-xl p-4">
                      <p className="text-xs text-muted-foreground mb-1">For any small business client:</p>
                      <p className="text-sm text-foreground italic">"Do you take credit cards? There's a compliant program that can get your processing fees to zero. I work with a team that does free reviews — want me to send them your contact info?"</p>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Example</p>
                  <p className="text-foreground leading-relaxed mb-4">
                    A restaurant client processes <strong>$60,000/month</strong> in cards. They're currently paying ~$1,800/month in fees. With a cash discount program, their fee drops to near zero.
                  </p>
                  <p className="text-foreground leading-relaxed mb-4">
                    Your monthly residual from Liberty's net: <strong className="text-primary">~$54–$65/month</strong> — every month they're active.
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Referring 10 similar clients creates <strong>$540–$650/month</strong> in passive income from conversations you're already having.
                  </p>
                </div>
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
                Simple. You make the introduction. We do the rest.
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
                Why Insurance Agents Choose Liberty Bancard
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
                What's Your Book Worth in Residuals?
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Enter the number of small business clients you'd refer and their typical monthly card volume to see your estimated residual income.
              </p>
            </div>
            <InsuranceResidualCalculator />
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
              Ready to Monetize Your Business Relationships?
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Apply as an Insurance Agent Partner today. We'll approve your application within 1 business day and send you a referral link and client conversation guide.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/partners#apply">
                <Button size="lg" variant="secondary" className="gap-2 w-full sm:w-auto" data-testid="button-ins-cta-apply">
                  Apply as an Insurance Partner <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/partners">
                <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10" data-testid="button-ins-cta-full-program">
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
