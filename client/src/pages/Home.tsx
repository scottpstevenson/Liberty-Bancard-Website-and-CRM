import { useState, useMemo, useEffect, useRef } from "react";
import { SEO, getLocalBusinessSchema, getWebSiteSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { WelcomePopup } from "@/components/WelcomePopup";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { CALENDAR_URL, PHONE_TEL, PHONE_NUMBER } from "@/lib/constants";
import { trackPhoneCtaClick, trackBookingCtaClick, trackStatementUploadCtaClick } from "@/lib/tracking";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PewcCheckbox } from "@/components/PewcCheckbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  FileText,
  ShieldCheck,
  Headphones,
  Scale,
  ArrowRight,
  CheckCircle2,
  Upload,
  Calculator,
  Stethoscope,
  Car,
  UtensilsCrossed,
  Wrench,
  Store,
  Star,
  Quote,
  Clock,
  DollarSign,
  Users,
  BadgeCheck,
  Phone,
  Building,
  HandshakeIcon,
  Banknote,
  Loader2,
  CheckCircle,
  Calendar,
  TrendingUp,
} from "lucide-react";
import logoBlue from "@assets/logo-blue.png";
import teamCollab from "@assets/images/team-collab.png";
import imgCloverFlex3 from "@assets/images/terminal-clover-flex-3.png";
import imgCloverMini3 from "@assets/images/terminal-clover-mini-3.png";
import imgCloverStationDuo from "@assets/images/terminal-clover-station-duo.png";
import imgPaxA920 from "@assets/images/terminal-pax-a920.png";
import dashboardPreview from "@assets/images/dashboard-preview.png";

function useCountUp(end: number, duration: number = 2000, suffix: string = "", divisor: number = 1, decimals: number = 0) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const steps = 60;
    const increment = end / steps;
    let current = 0;
    const interval = setInterval(() => {
      current += increment;
      if (current >= end) {
        setCount(end);
        clearInterval(interval);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(interval);
  }, [started, end, duration]);

  const formatted = divisor !== 1
    ? (count / divisor).toFixed(decimals)
    : decimals > 0
      ? count.toFixed(decimals)
      : count.toLocaleString();
  return { ref, display: `${formatted}${suffix}` };
}

const INDUSTRY_BENCHMARKS: Record<string, { low: number; mid: number; high: number; label: string }> = {
  restaurant: { low: 1.8, mid: 2.5, high: 3.2, label: "Restaurants" },
  retail: { low: 1.6, mid: 2.3, high: 3.0, label: "Retail" },
  medical: { low: 2.0, mid: 2.8, high: 3.5, label: "Medical/Dental" },
  automotive: { low: 2.2, mid: 3.0, high: 3.8, label: "Automotive" },
  services: { low: 2.4, mid: 3.2, high: 4.0, label: "Home Services" },
  ecommerce: { low: 2.5, mid: 3.3, high: 4.2, label: "E-Commerce" },
};

function getRateGrade(rate: number): { label: string; color: string; bg: string; message: string } {
  if (rate <= 2.0) return { label: "Competitive", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800", message: "Your rate looks competitive. Upload your statement to confirm there are no hidden fees inflating your cost." };
  if (rate <= 2.8) return { label: "Average", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800", message: "Most merchants in this range have room to reduce. A statement review will show exactly where." };
  if (rate <= 3.5) return { label: "Above Average", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800", message: "You're likely overpaying. Statement reviews at this level typically reveal specific cost drivers you can address." };
  return { label: "Needs Review", color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800", message: "Your effective rate is significantly above average. A statement review is strongly recommended to identify what's driving your cost." };
}

export default function Home() {
  const [monthlyVolume, setMonthlyVolume] = useState("");
  const [totalFees, setTotalFees] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("restaurant");
  const [cbName, setCbName] = useState("");
  const [cbPhone, setCbPhone] = useState("");
  const [cbBestTime, setCbBestTime] = useState("Morning");
  const [cbSubmitting, setCbSubmitting] = useState(false);
  const [cbSubmitted, setCbSubmitted] = useState(false);
  const [cbPewcConsent, setCbPewcConsent] = useState(false);
  const { toast } = useToast();

  const containerRef = useScrollReveal();
  const stat1 = useCountUp(10, 2000, "+");
  const stat2 = useCountUp(5000, 2000, "+");

  const handleCallbackSubmit = async () => {
    if (!cbName.trim() || !cbPhone.trim()) return;
    setCbSubmitting(true);
    try {
      await apiRequest("POST", "/api/public/callback", {
        name: cbName, phone: cbPhone, bestTime: cbBestTime, pewcConsent: cbPewcConsent,
      });
      setCbSubmitted(true);
    } catch (error: any) {
      toast({
        title: "Something went wrong",
        description: error.message || `Please try again or call us at ${PHONE_NUMBER}.`,
        variant: "destructive",
      });
    } finally {
      setCbSubmitting(false);
    }
  };

  const volume = parseFloat(monthlyVolume.replace(/[,$]/g, "")) || 0;
  const fees = parseFloat(totalFees.replace(/[,$]/g, "")) || 0;
  const effectiveRate = volume > 0 ? ((fees / volume) * 100) : null;
  const rateGrade = effectiveRate !== null ? getRateGrade(effectiveRate) : null;
  const benchmark = INDUSTRY_BENCHMARKS[selectedIndustry];

  const annualOverpay = useMemo(() => {
    if (!effectiveRate || effectiveRate <= 2.0) return null;
    const potentialSavings = volume * ((effectiveRate - 2.0) / 100) * 12;
    return Math.round(potentialSavings);
  }, [effectiveRate, volume]);

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Merchant Payment Processing | Liberty Bancard" description="See exactly what you pay to accept cards. Liberty Bancard provides transparent, statement-based pricing for businesses. Free statement review." path="/" keywords="payment processing, merchant services, credit card processing, statement review, interchange plus pricing, wholesale rates" structuredData={[getLocalBusinessSchema(), getWebSiteSchema()]} />
      <Navbar />
      <WelcomePopup />

      <main className="marketing-surface flex-grow pt-[72px] md:pt-24 dock-clearance-main md:pb-0" ref={containerRef}>

        {/* SECTION: Hero — Statement Intelligence editorial split */}
        <section className="marketing-surface relative overflow-hidden bg-background border-b border-border" data-testid="section-hero">
          {/* faint ledger texture wash */}
          <div className="pointer-events-none absolute inset-0 ledger-texture opacity-[0.5]" aria-hidden="true" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-24">
            <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-16 items-center">
              {/* Left column — message + CTAs */}
              <div className="accent-rule pt-5">
                <div className="si-load si-load-1 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm mb-6" data-testid="text-hero-badge">
                  <BadgeCheck className="w-3.5 h-3.5 text-accent" />
                  Free statement review — keep the breakdown even if you don't switch
                </div>
                <h1 className="si-load si-load-2 text-[2.75rem] leading-[0.98] sm:text-5xl lg:text-[3.5rem] lg:leading-[1.04] font-bold text-foreground mb-5 max-w-[16ch]" data-testid="text-hero-heading">
                  See What Your Processor Is <span className="text-accent">Really Charging</span>
                </h1>
                <p className="si-load si-load-3 text-base sm:text-lg text-muted-foreground leading-relaxed mb-8 max-w-xl" data-testid="text-hero-subheadline">
                  Upload a recent statement. Liberty turns the fee lines, downgrades, and monthly add-ons into a clear review you can actually use.
                </p>
                <div className="si-load si-load-4 flex flex-col sm:flex-row gap-3 flex-wrap" data-testid="hero-cta-block">
                  <Link href="/upload-statement" data-testid="link-hero-upload">
                    <Button size="lg" className="gap-2 w-full sm:w-auto" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: "Upload My Statement — Free", ctaLocation: "hero" })}>
                      <Upload className="w-4 h-4" />
                      Upload My Statement — Free
                    </Button>
                  </Link>
                  <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="link-hero-book" onClick={() => trackBookingCtaClick({ page: "/", ctaLabel: "Book a 15-Minute Review", ctaLocation: "hero" })}>
                    <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto">
                      <Calendar className="w-4 h-4" />
                      Book a 15-Minute Review
                    </Button>
                  </a>
                </div>
                <p className="si-load si-load-4 text-xs text-muted-foreground/80 mt-3 max-w-md" data-testid="text-hero-microcopy">
                  PDF or photo. 30 seconds. Redact account numbers if you want — we only need totals + fee lines.
                </p>
                <div className="si-load si-load-5 flex flex-wrap items-center gap-x-5 gap-y-2 mt-5">
                  <a href={PHONE_TEL} aria-label="Call Liberty Bancard" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors" data-testid="link-hero-phone" onClick={() => trackPhoneCtaClick({ page: "/", ctaLabel: PHONE_NUMBER, ctaLocation: "hero" })}>
                    <Phone className="w-3 h-3" />
                    {PHONE_NUMBER}
                  </a>
                  <Link href="/beat-square-stripe" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors" data-testid="link-hero-compare">
                    Compare My Current Setup
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
                {/* compact in-hero trust row */}
                <div className="si-load si-load-6 flex flex-wrap items-center gap-x-4 gap-y-2 mt-8 pt-6 border-t border-border">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" data-testid="text-hero-trust-1"><BadgeCheck className="w-3.5 h-3.5 text-accent" /> Statement-based review</span>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" data-testid="text-hero-trust-2"><FileText className="w-3.5 h-3.5 text-accent" /> Line-item breakdown</span>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" data-testid="text-hero-trust-3"><Headphones className="w-3.5 h-3.5 text-accent" /> Real human support</span>
                </div>
                {/* Compliance fine print — relocated from navbar strip */}
                <p className="text-xs leading-relaxed text-muted-foreground mt-4 max-w-md" data-testid="text-hero-compliance">
                  Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
                </p>
              </div>

              {/* Right column — layered Statement Intelligence audit module */}
              <div className="relative flex items-center justify-center lg:justify-end" data-testid="hero-visual">
                {/* navy authority panel behind the report */}
                <div className="pointer-events-none absolute -right-2 -top-4 hidden lg:block h-[88%] w-[78%] rounded-xl bg-primary" aria-hidden="true" />
                <div className="pointer-events-none absolute right-4 top-2 hidden lg:block h-2 w-24 bg-accent rounded-full" aria-hidden="true" />
                <div className="si-load si-load-3 relative w-full max-w-md rounded-xl border border-border bg-card shadow-elevated overflow-hidden">
                  {/* report header */}
                  <div className="flex items-center justify-between gap-3 bg-primary px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded bg-accent/20">
                        <FileText className="w-4 h-4 text-sky-300" />
                      </div>
                      <div className="leading-tight">
                        <div className="text-sm font-semibold text-white">Statement Fee Audit</div>
                        <div className="num text-[10px] text-white/55 tracking-wide">REF · LB-0000 · SAMPLE</div>
                      </div>
                    </div>
                    <span className="audit-stamp bg-card" data-testid="badge-illustrative">Illustrative</span>
                  </div>
                  {/* findings ledger */}
                  <div className="ledger-texture px-5">
                    {[
                      { label: "Effective rate", value: "3.47%", chip: "Above benchmark", tone: "negative" },
                      { label: "Monthly fixed fees", value: "$127/mo", chip: "Recurring", tone: "negative" },
                      { label: "Downgrades / card mix", value: "23%", chip: "Reducible", tone: "negative" },
                      { label: "Add-on fees (PCI, batch)", value: "$38/mo", chip: "Itemized", tone: "negative" },
                      { label: "Funding timeline", value: "Next-day*", chip: "Eligibility", tone: "neutral" },
                      { label: "Savings opportunity", value: "Identified", chip: "On review", tone: "positive" },
                    ].map((row, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-2.5 border-b border-border/70 last:border-0" data-testid={`row-statement-${i}`}>
                        <span className="text-[13px] text-foreground/80 min-w-0 truncate">{row.label}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`report-chip report-chip-${row.tone === "negative" ? "negative" : row.tone === "positive" ? "positive" : "neutral"}`}>{row.chip}</span>
                          <span className={`num text-sm font-semibold w-16 text-right ${row.tone === "negative" ? "text-stat-negative" : row.tone === "positive" ? "text-stat-positive" : "text-foreground"}`}>{row.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* report footer */}
                  <div className="border-t border-border bg-muted/40 px-5 py-3">
                    <p className="text-[10px] leading-relaxed text-muted-foreground">Actual findings require statement review. *Funding timing subject to eligibility, underwriting, and card brand rules.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION: Trust strip (merged) */}
        <section className="bg-card border-b border-border py-6" data-testid="section-trust-badges">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4">
              <div className="flex flex-col items-center gap-0.5 text-center" data-testid="trust-badge-years">
                <span className="text-lg font-bold text-foreground">FL-Based</span>
                <span className="text-xs font-semibold text-foreground">South Florida Team</span>
                <span className="text-xs text-muted-foreground">Local reps, real conversations</span>
              </div>
              <div className="w-px h-10 bg-border hidden sm:block" />
              <div className="flex flex-col items-center gap-0.5 text-center" data-testid="trust-badge-merchants">
                <span className="text-lg font-bold text-foreground">Free</span>
                <span className="text-xs font-semibold text-foreground">Statement Review</span>
                <span className="text-xs text-muted-foreground">Keep the breakdown either way</span>
              </div>
              <div className="w-px h-10 bg-border hidden sm:block" />
              <div className="flex flex-col items-center gap-0.5 text-center" data-testid="trust-badge-volume">
                <span className="text-lg font-bold text-foreground">I+P</span>
                <span className="text-xs font-semibold text-foreground">Interchange-Plus Pricing</span>
                <span className="text-xs text-muted-foreground">Transparent, line-item billing</span>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: Pain Points */}
        <section className="section-warm py-14" data-testid="section-pain">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-2xl mx-auto text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-3" data-testid="text-pain-heading">
                Sound Familiar?
              </h2>
              <p className="text-sm text-muted-foreground">The four patterns that show up most on the statements we review.</p>
            </div>
            <div className="reveal grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { icon: TrendingUp, chip: "Rate Mismatch", text: "You were quoted 1.5% — but your statement shows 3%+ all-in." },
                { icon: DollarSign, chip: "Fee Creep", text: "Monthly fees keep climbing and nobody explains why." },
                { icon: Clock, chip: "Funding Uncertainty", text: "Deposits land whenever, so cash flow is a guessing game." },
                { icon: Phone, chip: "Support Gap", text: "You call support and reach a call center, not an answer." },
              ].map((item, i) => (
                <div key={i} className="group rounded-lg border border-border bg-card p-4 shadow-card hover-elevate" data-testid={`card-pain-${i}`}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <item.icon className="w-4 h-4 text-stat-negative shrink-0" />
                    <span className="report-chip report-chip-negative">{item.chip}</span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
            <p className="text-center text-muted-foreground mt-8 text-sm" data-testid="text-pain-resolution">
              If any of this sounds right, your statement will tell us exactly what's going on.
            </p>
          </div>
        </section>

        {/* SECTION 3.5: By the Numbers — light report ledger */}
        <section className="reveal section-navy relative overflow-hidden py-16 md:py-20" data-testid="section-stats">
          <div className="pointer-events-none absolute inset-0 ledger-texture opacity-[0.08]" aria-hidden="true" />
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent" aria-hidden="true" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="num text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300">Liberty Bancard</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-10 md:mb-12" data-testid="text-stats-heading">
              By the Numbers
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
              <div ref={stat1.ref} className="rounded-lg border border-white/15 bg-white/10 p-6 backdrop-blur-sm" data-testid="stat-years">
                <div className="num text-5xl md:text-6xl font-bold text-white mb-2 tracking-tight">{stat1.display}</div>
                <div className="text-sm font-semibold text-white">Years in Business</div>
                <div className="text-xs text-white/65 mt-1">South Florida roots, nationwide reach</div>
              </div>
              <div ref={stat2.ref} className="rounded-lg border border-white/15 bg-white/10 p-6 backdrop-blur-sm" data-testid="stat-merchants">
                <div className="num text-5xl md:text-6xl font-bold text-white mb-2 tracking-tight">{stat2.display}</div>
                <div className="text-sm font-semibold text-white">Merchants Served</div>
                <div className="text-xs text-white/65 mt-1">Across every major vertical</div>
              </div>
              <div className="rounded-lg border border-white/15 bg-white/10 p-6 backdrop-blur-sm" data-testid="stat-support">
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-accent/25 border border-accent/30 shrink-0">
                    <Headphones className="w-6 h-6 text-sky-300" />
                  </div>
                  <span className="report-chip bg-white/10 border-white/20 text-sky-200">Every statement</span>
                </div>
                <div className="text-sm font-semibold text-white mt-3">Human Review Support</div>
                <div className="text-xs text-white/65 mt-1">A real person reads every statement you send</div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3.7: Processing Infrastructure & Compliance */}
        <section className="reveal bg-background border-b border-border py-12" data-testid="section-partners">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-center text-lg md:text-xl font-display font-bold text-foreground mb-2">
              Reviewed with the rules your processor already uses
            </p>
            <p className="text-center text-sm text-muted-foreground mb-8 max-w-xl mx-auto">
              Every review is grounded in the same card-brand and compliance framework your current provider operates under.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              {[
                { name: "Card-brand aware review", icon: BadgeCheck },
                { name: "PCI-aware documentation", icon: ShieldCheck },
                { name: "Funding & setup clarity", icon: Banknote },
                { name: "Human support throughout", icon: Headphones },
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center text-center gap-2 rounded-md border border-border bg-card px-3 py-4 shadow-card" data-testid={`partner-logo-${i}`}>
                  <item.icon className="w-5 h-5 text-accent shrink-0" />
                  <span className="text-xs font-semibold text-foreground leading-snug">{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 4: What You Get */}
        <section className="section-warm py-12 md:py-20" data-testid="section-what-you-get">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-12 items-start">
              <div className="reveal accent-rule pt-5">
                <span className="num text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">The Deliverable</span>
                <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4 mt-2" data-testid="text-what-you-get-heading">
                  What Your Liberty Review Includes
                </h2>
                <p className="text-muted-foreground mb-7">Not a quote. Not a pitch. A clear breakdown of what you're paying and why.</p>
                <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
                  <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3">
                    <span className="text-sm font-semibold text-foreground">Review Contents</span>
                    <span className="num text-[10px] uppercase tracking-[0.16em] text-muted-foreground">6 sections</span>
                  </div>
                  <ul className="ledger-texture divide-y divide-border/70">
                    {[
                      { chip: "Effective Rate", title: "Your true effective rate", desc: "Total fees divided by total volume — the one number that tells the truth." },
                      { chip: "Fee Drivers", title: "Fee driver map", desc: "Card mix, downgrades, monthly add-ons, batch fees, PCI charges — all of it." },
                      { chip: "Downgrades", title: "Downgrade review", desc: "Where transactions slip to higher-cost categories, and why." },
                      { chip: "Add-Ons", title: "Monthly add-on breakdown", desc: "Recurring line items, itemized and explained." },
                      { chip: "Funding", title: "Funding timeline*", desc: "When your money hits your account and what affects timing." },
                      { chip: "Options", title: "Options summary", desc: "2–3 clear options with real, apples-to-apples math." },
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-3 px-5 py-3.5" data-testid={`what-you-get-bullet-${i}`}>
                        <span className="report-chip report-chip-neutral mt-0.5 shrink-0 w-[92px] justify-center">{item.chip}</span>
                        <div className="min-w-0">
                          <span className="text-foreground font-medium text-sm">{item.title}</span>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="reveal reveal-delay-2 lg:sticky lg:top-32">
                <Card className="border-2 border-primary/20 overflow-hidden">
                  <div className="flex items-center justify-between gap-3 bg-primary px-5 py-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-sky-300" />
                      <span className="text-sm font-semibold text-white">Yours to Keep</span>
                    </div>
                    <span className="audit-stamp bg-card">No obligation</span>
                  </div>
                  <CardContent className="ledger-texture p-6 text-center">
                    <h3 className="text-xl font-display font-bold text-foreground mb-2" data-testid="text-keep-breakdown">You Keep the Breakdown</h3>
                    <p className="text-muted-foreground text-sm mb-6">Even if you don't switch. Zero obligation. It's yours — use it to negotiate with your current processor if you want.</p>
                    <Link href="/upload-statement" data-testid="link-what-you-get-upload">
                      <Button className="w-full gap-2" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: "Get My Free Analysis", ctaLocation: "what-you-get" })}>
                        <Upload className="w-4 h-4" />
                        Get My Free Analysis
                      </Button>
                    </Link>
                    <p className="text-xs text-muted-foreground mt-3">*Eligibility, underwriting, card brand rules, and applicable laws apply.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 5: How The Liberty Analysis Works (+ onboarding timeline) */}
        <section className="bg-background py-12 md:py-20" data-testid="section-how-it-works">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-2">
              <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-md uppercase tracking-wider mb-3">The Liberty Analysis</span>
            </div>
            <h2 className="reveal text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-4" data-testid="text-how-heading">
              How The Liberty Analysis Works
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">Three clear steps. Most reviews finish the same business day. You keep the results no matter what.</p>
            <div className="reveal relative grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="hidden md:block absolute top-7 left-[16.66%] right-[16.66%] h-0.5 bg-gradient-to-r from-border via-accent/40 to-border" aria-hidden="true" />
              {[
                { step: "1", icon: Upload, title: "Upload Your Statement", desc: "PDF or photo. 30 seconds. Redact account numbers if you want — we only need totals and fee lines.", cta: "Start Your Liberty Analysis", href: "/upload-statement" },
                { step: "2", icon: Calculator, title: "We Run The Liberty Analysis", desc: "Usually the same business day, we review every fee, markup, and cost driver line by line and calculate your true effective rate.", cta: null, href: null },
                { step: "3", icon: FileText, title: "You Get 2–3 Clear Options", desc: "Real math, no pressure. Compare options side by side. Keep the full breakdown either way.", cta: null, href: null },
              ].map((item, i) => (
                <div key={i} className="relative" data-testid={`step-${item.step}`}>
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-4 text-xl font-bold num relative z-10 ring-4 ring-background">
                      {item.step}
                    </div>
                    <h3 className="text-lg font-display font-bold text-foreground mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{item.desc}</p>
                    {item.cta && item.href && (
                      <Link href={item.href}>
                        <Button variant="outline" className="gap-2">
                          {item.cta}
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Contained onboarding timeline — secondary report card */}
            <div className="reveal mt-14 max-w-5xl mx-auto">
              <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3">
                  <h3 className="text-sm font-semibold text-foreground" data-testid="text-timeline-heading">
                    What Happens After You Say Yes
                  </h3>
                  <span className="num text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Onboarding · 48h target*</span>
                </div>
                <div className="ledger-texture p-6 sm:p-8">
                  <div className="relative">
                    <div className="hidden md:block absolute top-4 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-border via-accent/40 to-border" aria-hidden="true" />
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-3 gap-y-7">
                      {[
                        { day: "Day 0", title: "Upload", desc: "Statement in, review begins" },
                        { day: "Day 1", title: "Review", desc: "Line-item breakdown delivered" },
                        { day: "Day 1–2", title: "Decision", desc: "You review options, ask questions" },
                        { day: "Day 2–3", title: "Setup", desc: "Terminal shipped, account configured" },
                        { day: "Day 3–5", title: "Live", desc: "Processing live, first batch settles" },
                      ].map((step, i) => (
                        <div key={i} className="relative flex flex-col items-center text-center" data-testid={`timeline-step-${i}`}>
                          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold num mb-3 relative z-10 ring-4 ring-card">
                            {i + 1}
                          </div>
                          <span className="num text-[11px] font-semibold text-accent mb-1 tracking-wide">{step.day}</span>
                          <span className="text-sm font-semibold text-foreground mb-0.5">{step.title}</span>
                          <span className="text-xs text-muted-foreground leading-snug">{step.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="border-t border-border bg-muted/30 px-5 py-3 text-[10px] leading-relaxed text-muted-foreground">
                  *Timeline is illustrative. Actual timelines depend on underwriting, equipment availability, and merchant response time. Eligibility, underwriting, card brand rules, and applicable laws apply.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 6: Enhanced Rate Calculator */}
        <section className="section-warm bg-dots py-12 md:py-20" data-testid="section-calculator">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div className="reveal">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center">
                    <Calculator className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground" data-testid="text-calculator-heading">
                      60-Second Rate Check
                    </h2>
                  </div>
                </div>
                <p className="text-muted-foreground mb-8" data-testid="text-calculator-desc">
                  Enter your numbers from last month's statement. We'll calculate your effective rate and show you where you stand.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="monthly-volume">
                      Monthly Processing Volume ($)
                    </label>
                    <Input
                      id="monthly-volume"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 50,000"
                      value={monthlyVolume}
                      onChange={(e) => setMonthlyVolume(e.target.value)}
                      data-testid="input-monthly-volume"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="total-fees">
                      Total Processing Fees ($)
                    </label>
                    <Input
                      id="total-fees"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 1,500"
                      value={totalFees}
                      onChange={(e) => setTotalFees(e.target.value)}
                      data-testid="input-total-fees"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      Your Industry
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(INDUSTRY_BENCHMARKS).map(([key, val]) => (
                        <button
                          key={key}
                          onClick={() => setSelectedIndustry(key)}
                          className={`text-xs font-medium py-2 px-3 rounded-md border transition-colors ${
                            selectedIndustry === key
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border hover:border-primary/50"
                          }`}
                          data-testid={`button-industry-${key}`}
                        >
                          {val.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:sticky lg:top-32">
                {effectiveRate !== null ? (
                  <div className="space-y-4" data-testid="display-calculator-results">
                    <Card className={`border-2 ${rateGrade?.bg}`}>
                      <CardContent className="ledger-texture p-6">
                        <div className="text-center mb-4">
                          <div className="text-sm text-muted-foreground mb-1">Your Effective Rate</div>
                          <div className={`num text-5xl font-bold ${rateGrade?.color}`} data-testid="display-effective-rate">
                            {effectiveRate.toFixed(2)}%
                          </div>
                          <div className={`text-sm font-semibold mt-1 ${rateGrade?.color}`} data-testid="display-rate-grade">
                            {rateGrade?.label}
                          </div>
                        </div>

                        <p className="text-sm text-muted-foreground text-center mb-4" data-testid="display-rate-message">
                          {rateGrade?.message}
                        </p>

                        {annualOverpay && annualOverpay > 500 && (
                          <div className="bg-background/80 rounded-md p-3 text-center mb-4" data-testid="display-annual-impact">
                            <div className="text-xs text-muted-foreground">Estimated annual impact*</div>
                            <div className="text-2xl font-bold text-foreground">${annualOverpay.toLocaleString()}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">*Illustrative estimate only. Actual results require statement review.</div>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4">
                        <div className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">{benchmark.label} Benchmarks</div>
                        <div className="relative h-3 bg-muted rounded-full mb-2 overflow-visible">
                          <div className="absolute left-0 h-full bg-emerald-400/40 rounded-l-full" style={{ width: `${(benchmark.low / 5) * 100}%` }} />
                          <div className="absolute h-full bg-amber-400/40" style={{ left: `${(benchmark.low / 5) * 100}%`, width: `${((benchmark.mid - benchmark.low) / 5) * 100}%` }} />
                          <div className="absolute h-full bg-red-400/40 rounded-r-full" style={{ left: `${(benchmark.mid / 5) * 100}%`, width: `${((5 - benchmark.mid) / 5) * 100}%` }} />
                          {effectiveRate <= 5 && (
                            <div
                              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-foreground border-2 border-background shadow-lg"
                              style={{ left: `${Math.min((effectiveRate / 5) * 100, 98)}%`, transform: 'translate(-50%, -50%)' }}
                              data-testid="display-rate-marker"
                            />
                          )}
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>{benchmark.low}% (low)</span>
                          <span>{benchmark.mid}% (avg)</span>
                          <span>{benchmark.high}%+ (high)</span>
                        </div>
                      </CardContent>
                    </Card>

                    <Link href="/upload-statement" data-testid="link-calculator-upload">
                      <Button className="w-full gap-2" size="lg">
                        Get My Exact Line-Item Breakdown
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                    <p className="text-xs text-muted-foreground text-center">
                      This calculator provides an estimate only. Upload your statement for a precise, line-item analysis. Eligibility, underwriting, card brand rules, and applicable laws apply.
                    </p>
                  </div>
                ) : (
                  <Card className="border-dashed border-2 border-border/70 overflow-hidden">
                    <div className="accent-rule flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3">
                      <span className="text-sm font-semibold text-foreground">Estimate Preview</span>
                      <span className="audit-stamp bg-card">Awaiting input</span>
                    </div>
                    <CardContent className="ledger-texture p-8 text-center">
                      <Calculator className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                      <h3 className="text-lg font-display font-semibold text-foreground mb-2" data-testid="text-calculator-empty">Run a 60-second effective-rate check</h3>
                      <p className="text-sm text-muted-foreground">
                        Plug in your monthly volume and total fees from your last statement. We'll instantly estimate your effective rate and compare it against your industry benchmark — no upload required.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 7: Choose Your Path */}
        <section className="section-warm py-12 md:py-20" data-testid="section-choose-path">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-4" data-testid="text-choose-path-heading">
              Choose the Strategy That Fits
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">Every business is different. Here are the most common paths our merchants take.</p>
            {/* Mobile: Accordion — Upload-focused, collapsed by default except Wholesale */}
            <Accordion type="single" collapsible defaultValue="wholesale" className="md:hidden rounded-lg border border-border overflow-hidden" data-testid="accordion-choose-path">
              <AccordionItem value="wholesale" className="border-b border-border last:border-0" data-testid="card-wholesale-mobile">
                <AccordionTrigger className="px-4 py-3 hover:no-underline [&>svg]:shrink-0">
                  <div className="text-left mr-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-primary text-primary-foreground text-[10px] font-semibold px-2 py-0.5 rounded">Most Popular</span>
                    </div>
                    <div className="font-display font-semibold text-foreground">Wholesale / Interchange-Plus</div>
                    <div className="text-xs text-muted-foreground font-normal mt-0.5">Transparent fee on top of interchange — see every penny of markup</div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Real interchange passthrough</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> No bundled "qualified" tiers</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Full cost transparency</li>
                  </ul>
                  <Link href="/upload-statement" data-testid="link-wholesale-cta-mobile">
                    <Button className="gap-2 w-full">Run My Review <ArrowRight className="w-4 h-4" /></Button>
                  </Link>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="zero-percent" className="border-b border-border last:border-0" data-testid="card-zero-percent-mobile">
                <AccordionTrigger className="px-4 py-3 hover:no-underline [&>svg]:shrink-0">
                  <div className="text-left mr-2">
                    <div className="font-display font-semibold text-foreground">Compliant 0% Programs*</div>
                    <div className="text-xs text-muted-foreground font-normal mt-0.5">Pass fees to the cardholder where permitted by law and card brand rules</div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Cash discount or surcharging</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Proper disclosures + receipts</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Staff scripts included</li>
                  </ul>
                  <Link href="/0-percent-processing" data-testid="link-zero-percent-cta-mobile">
                    <Button variant="outline" className="gap-2 w-full">Check 0% Fit <ArrowRight className="w-4 h-4" /></Button>
                  </Link>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="terminal" className="border-b border-border last:border-0" data-testid="card-terminal-mobile">
                <AccordionTrigger className="px-4 py-3 hover:no-underline [&>svg]:shrink-0">
                  <div className="text-left mr-2">
                    <div className="font-display font-semibold text-foreground">Liberty Smart Terminal</div>
                    <div className="text-xs text-muted-foreground font-normal mt-0.5">Modern checkout with guided onboarding and dedicated support</div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Tap, dip, swipe, manual key</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Free for qualifying merchants*</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Same-day setup when eligible</li>
                  </ul>
                  <Link href="/upload-statement?terminal=yes" data-testid="link-terminal-cta-mobile">
                    <Button variant="outline" className="gap-2 w-full">Check Eligibility <ArrowRight className="w-4 h-4" /></Button>
                  </Link>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Desktop: three-column Card grid — unchanged */}
            <div className="reveal hidden md:grid md:grid-cols-3 gap-6 items-stretch">
              <Card className="relative overflow-visible h-full flex flex-col border-primary/40 shadow-card-hover" data-testid="card-wholesale">
                <div className="absolute -top-3 left-4">
                  <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-md">Most Popular</span>
                </div>
                <CardHeader className="gap-1">
                  <span className="report-chip report-chip-neutral w-fit">Best For: High-volume, transparency-first</span>
                  <CardTitle className="text-lg">Wholesale / Interchange-Plus</CardTitle>
                  <CardDescription>See every penny of markup. Pay interchange + a transparent fee.</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Real interchange passthrough</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> No bundled "qualified" tiers</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Full cost transparency</li>
                  </ul>
                  <div className="mt-4 rounded-md border border-border bg-card px-3 py-2">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Illustrative structure</div>
                    <div className="num text-sm font-semibold text-foreground">Interchange + 0.25%<span className="font-normal text-muted-foreground"> / transaction*</span></div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Link href="/upload-statement" data-testid="link-wholesale-cta">
                    <Button className="gap-2">
                      Run My Review
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardFooter>
              </Card>

              <Card className="h-full flex flex-col" data-testid="card-zero-percent">
                <CardHeader className="gap-1">
                  <span className="report-chip report-chip-neutral w-fit">Best For: Offsetting processing costs</span>
                  <CardTitle className="text-lg">Compliant 0% Programs*</CardTitle>
                  <CardDescription>Pass fees to the cardholder where permitted by law and card brand rules.</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Cash discount or surcharging</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Proper disclosures + receipts</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Staff scripts included</li>
                  </ul>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-md border border-border bg-card px-2 py-2 text-center">
                      <div className="text-xs font-semibold text-foreground">Cash Discount</div>
                      <div className="text-[11px] text-muted-foreground">Lower posted price for cash</div>
                    </div>
                    <div className="rounded-md border border-border bg-card px-2 py-2 text-center">
                      <div className="text-xs font-semibold text-foreground">Surcharging</div>
                      <div className="text-[11px] text-muted-foreground">Card fee where permitted</div>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Link href="/0-percent-processing" data-testid="link-zero-percent-cta">
                    <Button variant="outline" className="gap-2">
                      Check 0% Fit
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardFooter>
              </Card>

              <Card className="relative overflow-visible h-full flex flex-col" data-testid="card-terminal">
                <CardHeader className="gap-1">
                  <span className="report-chip report-chip-neutral w-fit">Best For: Modern in-person checkout</span>
                  <CardTitle className="text-lg">Liberty Smart Terminal</CardTitle>
                  <CardDescription>Modern checkout with guided onboarding and dedicated support.</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="rounded-md overflow-hidden mb-3">
                    <img src={imgCloverFlex3} alt="Clover Flex 3 payment terminal" className="w-full h-32 object-contain bg-muted/50 p-2" loading="lazy" width="400" height="128" data-testid="img-home-terminal" />
                  </div>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Tap, dip, swipe, manual key</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Free for qualifying merchants*</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Same-day setup when eligible</li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Link href="/upload-statement?terminal=yes" data-testid="link-terminal-cta">
                    <Button variant="outline" className="gap-2">
                      Check Eligibility
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            </div>
            <p className="text-center text-xs text-muted-foreground mt-6" data-testid="text-choose-path-footnote">
              *Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
            </p>
          </div>
        </section>

        {/* SECTION 8: Vertical Credibility */}
        <section className="bg-background bg-dots py-12 md:py-20" data-testid="section-verticals">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-verticals-heading">
                Built for Operators Who Run Real Businesses
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">South Florida roots. Nationwide reach. We know the cost pressures in your industry.</p>
            </div>
            {/* Mobile: Accordion for top industries */}
            <Accordion type="single" collapsible className="lg:hidden rounded-lg border border-border overflow-hidden mb-6" data-testid="accordion-verticals">
              {[
                { icon: UtensilsCrossed, title: "Restaurants", bestFor: "Tip-adjust + weekend volume", points: ["Fast tip-adjusted checkout that won't freeze on a Friday night", "Weekend support when your team actually needs it"] },
                { icon: Stethoscope, title: "Medical / Dental / Medspa", bestFor: "Front-desk speed + clean deposits", points: ["Predictable deposit clarity for the front desk", "HIPAA-aware workflows and fewer billing headaches"] },
                { icon: Car, title: "Automotive", bestFor: "High-ticket + chargeback safety", points: ["High-ticket transaction handling with predictable funding", "Chargeback prevention built into the workflow"] },
              ].map((item, i) => (
                <AccordionItem key={i} value={`vertical-${i}`} className="border-b border-border last:border-0" data-testid={`vertical-mobile-${i}`}>
                  <AccordionTrigger className="px-4 py-3 hover:no-underline [&>svg]:shrink-0">
                    <div className="flex items-center gap-3 text-left mr-2">
                      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <item.icon className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-display font-semibold text-foreground text-sm">{item.title}</div>
                        <div className="text-xs text-muted-foreground font-normal">Best For: {item.bestFor}</div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <ul className="space-y-2">
                      {item.points.map((point, j) => (
                        <li key={j} className="text-sm text-muted-foreground flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            {/* Desktop: three-column grid — unchanged */}
            <div className="reveal hidden lg:grid lg:grid-cols-3 gap-6 mb-6">
              {[
                { icon: UtensilsCrossed, title: "Restaurants", bestFor: "Tip-adjust + weekend volume", points: ["Fast tip-adjusted checkout that won't freeze on a Friday night", "Weekend support when your team actually needs it"] },
                { icon: Stethoscope, title: "Medical / Dental / Medspa", bestFor: "Front-desk speed + clean deposits", points: ["Predictable deposit clarity for the front desk", "HIPAA-aware workflows and fewer billing headaches"] },
                { icon: Car, title: "Automotive", bestFor: "High-ticket + chargeback safety", points: ["High-ticket transaction handling with predictable funding", "Chargeback prevention built into the workflow"] },
              ].map((item, i) => (
                <Card key={i} className="hover-elevate" data-testid={`card-vertical-featured-${i}`}>
                  <CardContent className="p-6">
                    <span className="report-chip report-chip-neutral">Best For: {item.bestFor}</span>
                    <div className="flex items-center gap-3 mt-4 mb-4">
                      <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <item.icon className="w-6 h-6 text-primary" />
                      </div>
                      <h3 className="text-lg font-display font-semibold text-foreground">{item.title}</h3>
                    </div>
                    <ul className="space-y-2">
                      {item.points.map((point, j) => (
                        <li key={j} className="text-sm text-muted-foreground flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
            {/* Secondary compact cards — 2-col on mobile, 3-col on sm+ */}
            <div className="reveal grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { icon: Wrench, title: "Home Services", bestFor: "On-the-job mobile acceptance" },
                { icon: Store, title: "Retail", bestFor: "Fast lines + contactless" },
                { icon: Users, title: "Other Industries", bestFor: "Every vertical — the math is the math" },
              ].map((item, i) => (
                <Card key={i} className="hover-elevate" data-testid={`card-vertical-secondary-${i}`}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-display font-semibold text-foreground">{item.title}</h3>
                      <p className="text-xs text-muted-foreground">Best For: {item.bestFor}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 8.25: Terminal Showcase */}
        <section className="bg-background py-12 md:py-20" data-testid="section-terminal-showcase">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center max-w-2xl mx-auto mb-10">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-terminal-showcase-heading">
                What Setup Looks Like After Approval
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Once you're approved, we configure your hardware to match how you actually take payments — with guided setup and dedicated support from day one.
              </p>
            </div>
            <div className="reveal grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
              <div className="lg:col-span-2">
                <div className="rounded-md border border-border bg-muted/30 p-6">
                  <img src={imgCloverFlex3} alt="Clover Flex 3 handheld POS terminal" className="w-full h-56 object-contain" loading="lazy" width="400" height="224" data-testid="img-showcase-hero" />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <img src={imgCloverStationDuo} alt="Clover Station Duo full register system" className="w-full h-20 rounded-md border border-border bg-muted/30 object-contain p-1.5" loading="lazy" width="160" height="80" data-testid="img-showcase-stand" />
                  <img src={imgCloverMini3} alt="Clover Mini 3 countertop POS" className="w-full h-20 rounded-md border border-border bg-muted/30 object-contain p-1.5" loading="lazy" width="160" height="80" data-testid="img-showcase-angle" />
                  <img src={imgPaxA920} alt="PAX A920 smart payment terminal" className="w-full h-20 rounded-md border border-border bg-muted/30 object-contain p-1.5" loading="lazy" width="160" height="80" data-testid="img-showcase-tap" />
                </div>
              </div>
              <div className="lg:col-span-3">
                {/* Mobile: stacked cards — four-column table fully absent on mobile */}
                <div className="md:hidden space-y-3 mb-5">
                  {[
                    { option: "Smart Terminal", bestFor: "Counter + curbside", includes: "Tap, dip, swipe, key; tip adjust; batch close", notes: "Free for qualifying merchants*" },
                    { option: "POS Setup", bestFor: "Full-service & retail", includes: "Register, on-device reporting, inventory-friendly", notes: "Hardware varies by plan" },
                    { option: "Virtual / Keyed", bestFor: "Phone & invoice sales", includes: "Virtual terminal, secure pay links, keyed entry", notes: "No hardware required" },
                  ].map((row, i) => (
                    <div key={i} className="rounded-lg border border-border bg-card p-4" data-testid={`card-terminal-mobile-${i}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="font-display font-semibold text-foreground text-sm">{row.option}</span>
                        <span className="report-chip report-chip-neutral shrink-0">{row.bestFor}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1"><span className="font-medium text-foreground">Includes:</span> {row.includes}</p>
                      <p className="text-xs text-muted-foreground">{row.notes}</p>
                    </div>
                  ))}
                </div>
                {/* Desktop: four-column table */}
                <div className="hidden md:block overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-left text-sm" data-testid="table-terminal-setup">
                    <thead>
                      <tr className="bg-muted/50 text-foreground">
                        <th className="px-4 py-3 font-display font-semibold">Option</th>
                        <th className="px-4 py-3 font-display font-semibold">Best For</th>
                        <th className="px-4 py-3 font-display font-semibold">Includes</th>
                        <th className="px-4 py-3 font-display font-semibold">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[
                        { option: "Smart Terminal", bestFor: "Counter + curbside", includes: "Tap, dip, swipe, key; tip adjust; batch close", notes: "Free for qualifying merchants*" },
                        { option: "POS Setup", bestFor: "Full-service & retail", includes: "Register, on-device reporting, inventory-friendly", notes: "Hardware varies by plan" },
                        { option: "Virtual / Keyed", bestFor: "Phone & invoice sales", includes: "Virtual terminal, secure pay links, keyed entry", notes: "No hardware required" },
                      ].map((row, i) => (
                        <tr key={i} className="align-top" data-testid={`row-terminal-${i}`}>
                          <td className="px-4 py-3 font-semibold text-foreground">{row.option}</td>
                          <td className="px-4 py-3"><span className="report-chip report-chip-neutral">{row.bestFor}</span></td>
                          <td className="px-4 py-3 text-muted-foreground">{row.includes}</td>
                          <td className="px-4 py-3 text-muted-foreground">{row.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link href="/upload-statement?terminal=yes" data-testid="link-terminal-showcase-cta">
                    <Button className="gap-2">
                      Check Terminal Eligibility
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Link href="/upload-statement?terminal=yes" className="text-sm text-primary hover:underline" data-testid="link-terminal-showcase-eligibility">See eligibility details →</Link>
                </div>
                <p className="text-xs text-muted-foreground mt-3">*Eligibility, underwriting, card brand rules, and applicable laws apply. Free terminal subject to qualification.</p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 8.4: Platform Preview — desktop-only, hidden on mobile */}
        <section className="hidden md:block bg-background bg-grid py-20 overflow-hidden" data-testid="section-platform-preview">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 text-xs font-semibold px-3 py-1 rounded-md mb-4">
                  Full account visibility
                </div>
                <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-platform-heading">
                  After switching, your team gets full operational visibility
                </h2>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  Behind every Liberty merchant account is a full operations platform — so the team supporting you sees your pipeline, tickets, and onboarding in real time, and nothing falls through the cracks.
                </p>
                <div className="space-y-3 mb-6">
                  {[
                    "A dedicated team that sees your full account history",
                    "Support tickets tracked to resolution with SLAs",
                    "Onboarding steps mapped and monitored end to end",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-foreground">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <Link href="/get-started" data-testid="link-platform-dashboard">
                  <Button variant="outline" className="gap-2">
                    See How Liberty Manages Your Account
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
              <div className="relative">
                <div className="rounded-md overflow-hidden shadow-2xl border border-border">
                  <img src={dashboardPreview} alt="Liberty Bancard CRM dashboard showing merchant pipeline and KPI metrics" className="w-full h-auto" loading="lazy" width="1408" height="792" data-testid="img-platform-preview" />
                </div>
                <div className="absolute -bottom-4 -right-4 -z-10 w-full h-full rounded-md bg-gradient-to-br from-sky-500/20 to-primary/20" />
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 8.5: Why Liberty - Differentiators */}
        <section className="bg-background py-12 md:py-20" data-testid="section-why-liberty">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-8">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-why-liberty-heading">
                Why Merchants Switch to Liberty
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">The differences you feel every day, not just on paper.</p>
            </div>

            {/* Rate Transparency Callout */}
            <div className="reveal mb-12" data-testid="section-rate-transparency">
              <div className="ledger-texture max-w-3xl mx-auto bg-background border-2 border-primary/20 rounded-lg p-6 md:p-8">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <DollarSign className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="accent-rule pt-3 mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-lg font-display font-bold text-foreground" data-testid="text-rate-transparency-heading">
                        What Do Most Merchants Actually Pay?
                      </h3>
                      <span className="audit-stamp shrink-0">Illustrative</span>
                    </div>
                    <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
                      On interchange-plus pricing, most merchants end up paying between <strong className="num text-foreground">1.7%–2.3%</strong> all-in — depending on their card mix and volume. That compares to <strong className="num text-foreground">2.6%–3.5%+</strong> on flat-rate plans like Square or Stripe.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                      {[
                        { label: "Restaurant (card-present)", range: "1.80–2.20%", note: "High debit, fast turns" },
                        { label: "Retail (mixed cards)", range: "1.75–2.15%", note: "Debit + credit mix" },
                        { label: "Services / B2B", range: "2.00–2.60%", note: "More rewards + keyed" },
                      ].map((item, i) => (
                        <div key={i} className="rounded-md border border-primary/15 bg-card p-3 text-center shadow-sm" data-testid={`text-rate-range-${i}`}>
                          <span className="report-chip report-chip-neutral mx-auto mb-2">{item.label}</span>
                          <div className="num text-lg font-display font-bold text-primary">{item.range}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{item.note}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      *Typical effective rate ranges for interchange-plus pricing. Actual rate depends on your card mix, transaction types, and volume — upload a statement for your exact number. No savings claims without a statement review.
                    </p>
                    <Link href="/beat-square-stripe" className="inline-flex items-center gap-1.5 text-primary text-sm font-medium mt-3 hover:underline" data-testid="link-rate-transparency-compare">
                      See full processor comparison <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: FileText, title: "Statement-Based Pricing", desc: "We price off your actual statement, not a generic quote. You see exactly what changes and why." },
                { icon: Headphones, title: "Direct Human Support", desc: "A real person picks up the phone. No ticket queues, no chatbots, no 3-day wait." },
                { icon: Banknote, title: "Next-Day Funding*", desc: "For qualifying merchants, funds hit your account the next business day. Cash flow you can count on." },
                { icon: HandshakeIcon, title: "Month-to-Month Terms", desc: "We earn your business every month. Standard processing terms apply — no long-term lock-in, no pressure." },
              ].map((item, i) => (
                <Card key={i} className="bg-primary/5 border-primary/15" data-testid={`card-why-liberty-${i}`}>
                  <CardContent className="p-5">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-3">
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-display font-semibold text-foreground mb-1.5">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-center text-xs text-muted-foreground mt-6" data-testid="text-why-liberty-footnote">
              *Eligibility, underwriting, card brand rules, and applicable laws apply.
            </p>
          </div>
        </section>

        {/* SECTION 8.75: Savings Guarantee */}
        <section className="bg-background py-10" data-testid="section-savings-guarantee">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <Card className="overflow-hidden border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                <div className="h-1 w-full bg-emerald-500" />
                <CardContent className="p-8">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                    <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <h2 className="text-xl md:text-2xl font-display font-bold text-foreground mb-2" data-testid="text-guarantee-heading">
                        If the math doesn't support switching, we'll tell you
                      </h2>
                      <p className="text-muted-foreground leading-relaxed" data-testid="text-guarantee-body">
                        We'll show you your real effective rate, compare it to your current processor line by line, and if we can't find meaningful savings — we'll tell you upfront. No pressure, no obligation. The breakdown is yours to keep either way.
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 pt-5 border-t border-emerald-200 dark:border-emerald-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      "No commitment to see your numbers",
                      "Honest if the math doesn't work",
                      "You keep the full breakdown regardless",
                    ].map((point, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-foreground" data-testid={`guarantee-point-${i}`}>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        {point}
                      </div>
                    ))}
                  </div>
                  <div className="mt-5">
                    <Link href="/upload-statement" data-testid="link-guarantee-cta">
                      <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: "Get My Free Analysis", ctaLocation: "savings-guarantee" })}>
                        <Upload className="w-4 h-4" />
                        Get My Free Analysis
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* SECTION 9: Social Proof / Reviews */}
        <section className="section-warm py-12 md:py-20" data-testid="section-reviews">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="reveal text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-4" data-testid="text-reviews-heading">
              What Merchants Say After Their First Review
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">Real business owners. Specific outcomes. Florida-based merchants you can relate to.</p>
            {/* Mobile: single strong testimonial */}
            <div className="md:hidden mb-6" data-testid="card-review-mobile-primary">
              <Card>
                <CardContent className="p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">0% program</span>
                  </div>
                  <Quote className="w-6 h-6 text-primary/20 mb-2" />
                  <p className="text-sm text-foreground mb-5 leading-relaxed">We were paying Square over $1,100 a month. After switching to Liberty Bancard's cash discount program, our processing cost dropped to nearly zero — saving us $340 a month. That money went straight back into our kitchen.</p>
                  <div className="flex items-center gap-3 pt-4 border-t border-border">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">M</div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">Maria R.</div>
                      <div className="text-xs text-muted-foreground">Restaurant Owner · South Miami, FL</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Desktop: full three-column review grid */}
            <div className="reveal hidden md:grid md:grid-cols-3 gap-6 mb-10">
              {[
                {
                  quote: "We were paying Square over $1,100 a month. After switching to Liberty Bancard's cash discount program, our processing cost dropped to nearly zero — saving us $340 a month. That money went straight back into our kitchen.",
                  name: "Maria R.",
                  role: "Restaurant Owner",
                  city: "South Miami, FL",
                  stars: 5,
                  highlight: "0% program",
                },
                {
                  quote: "Liberty Bancard pulled our statement apart line by line and found $127 a month in fees we never agreed to — PCI non-compliance charges, a regulatory fee, and a statement fee that appeared out of nowhere. The switch cleaned it all up.",
                  name: "Tony M.",
                  role: "Auto Repair Shop Owner",
                  city: "Broward County, FL",
                  stars: 5,
                  highlight: "Statement review",
                },
                {
                  quote: "We thought Stripe was our only option. Liberty Bancard showed us the exact markup we were paying on top of interchange and switched us to interchange-plus. We're saving over $300 a month without touching our website.",
                  name: "David K.",
                  role: "Retail Store Owner",
                  city: "Boca Raton, FL",
                  stars: 5,
                  highlight: "Switched from Stripe",
                },
              ].map((review, i) => (
                <Card key={i} data-testid={`card-review-${i}`}>
                  <CardContent className="p-6 flex flex-col h-full">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex gap-0.5">
                        {Array.from({ length: review.stars }).map((_, j) => (
                          <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                        ))}
                      </div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full" data-testid={`text-review-highlight-${i}`}>{review.highlight}</span>
                    </div>
                    <Quote className="w-6 h-6 text-primary/20 mb-2" />
                    <p className="text-sm text-foreground mb-5 leading-relaxed flex-grow" data-testid={`text-review-quote-${i}`}>{review.quote}</p>
                    <div className="flex items-center gap-3 pt-4 border-t border-border">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                        {review.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-foreground" data-testid={`text-review-name-${i}`}>{review.name}</div>
                        <div className="text-xs text-muted-foreground" data-testid={`text-review-role-${i}`}>{review.role} · {review.city}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {/* Mobile: compact outcome CTA */}
            <div className="md:hidden mb-6 text-center">
              <Link href="/case-studies" data-testid="link-reviews-case-studies-mobile">
                <Button variant="outline" className="gap-2 w-full">
                  See documented case studies <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
            {/* Desktop: documented outcome strip */}
            <div className="reveal hidden md:grid md:grid-cols-3 gap-4 mb-10" data-testid="grid-outcomes-strip">
              {[
                { type: "Full-Service Restaurant", solution: "Cash Discount Program", result: "$4,200/yr", href: "/case-studies#restaurant-square" },
                { type: "Multi-Location Retail", solution: "Interchange Plus", result: "$3,800/yr", href: "/case-studies#retail-stripe" },
                { type: "Medical Practice", solution: "Interchange Plus + Level 2", result: "$6,100/yr", href: "/case-studies#healthcare-bank" },
              ].map((o, i) => (
                <Link key={i} href={o.href} className="block hover-elevate rounded-lg" data-testid={`link-outcome-detail-${i}`}>
                  <div className="h-full rounded-lg border border-border bg-card p-4 shadow-card">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-foreground" data-testid={`text-outcome-type-${i}`}>{o.type}</span>
                      <span className="num text-lg font-display font-bold text-emerald-600 dark:text-emerald-400" data-testid={`text-outcome-result-${i}`}>{o.result}</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{o.solution}</div>
                  </div>
                </Link>
              ))}
            </div>
            <p className="text-center text-xs text-muted-foreground mb-6">Documented case-study results. Individual outcomes vary by card mix, volume, and program eligibility.</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/case-studies" data-testid="link-reviews-case-studies">
                <Button variant="outline" className="gap-2">
                  See the full breakdown in our case studies
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/testimonials" data-testid="link-video-testimonials-all">
                <Button variant="ghost" className="gap-2">
                  Watch merchant stories
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* SECTION 10: Trust / Risk Reversal — sharp navy block */}
        <section className="reveal relative overflow-hidden bg-primary py-12 md:py-20" data-testid="section-risk-reversal">
          <img src={teamCollab} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-[0.15] mix-blend-luminosity" loading="lazy" width="1408" height="792" />
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent" aria-hidden="true" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <ShieldCheck className="w-14 h-14 text-sky-300 mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-6" data-testid="text-risk-reversal-heading">
                Proof First. Pressure Never.
              </h2>
              <p className="text-lg text-white/80 leading-relaxed mb-4" data-testid="text-risk-reversal-body-1">
                We don't ask you to sign anything to get a statement review. We don't lock you into a contract to see your numbers. And if we can't find a meaningful improvement, we'll tell you.
              </p>
              <p className="text-white/70 leading-relaxed mb-8" data-testid="text-risk-reversal-body-2">
                You keep the line-item breakdown either way. Use it to negotiate with your current processor, share it with your accountant, or just understand what you're paying for the first time.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
                {[
                  { icon: FileText, label: "No contract required" },
                  { icon: ShieldCheck, label: "Keep the breakdown" },
                  { icon: Scale, label: "Zero obligation" },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-5" data-testid={`trust-signal-${i}`}>
                    <div className="w-11 h-11 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center">
                      <item.icon className="w-5 h-5 text-sky-300" />
                    </div>
                    <span className="text-sm font-medium text-white">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 10.5: Security & Compliance Trust Badges */}
        <section className="bg-background py-10 md:py-16" data-testid="section-security-badges">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h3 className="text-center text-lg font-display font-bold text-foreground mb-8" data-testid="text-security-heading">
              Security & Compliance Standards
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { icon: ShieldCheck, label: "PCI DSS Compliant", desc: "Level 1 payment data security" },
                { icon: BadgeCheck, label: "EMV Certified", desc: "Chip-card technology standard" },
                { icon: ShieldCheck, label: "End-to-End Encryption", desc: "All transaction data encrypted" },
                { icon: BadgeCheck, label: "Tokenization", desc: "Card data replaced with secure tokens" },
              ].map((badge, i) => (
                <Card key={i} className="text-center" data-testid={`security-badge-${i}`}>
                  <CardContent className="p-4 flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                      <badge.icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="text-sm font-medium text-foreground">{badge.label}</span>
                    <span className="text-xs text-muted-foreground">{badge.desc}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 11: FAQ */}
        <section className="section-warm py-12 md:py-20" data-testid="section-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8" data-testid="text-faq-heading">
                Common Questions
              </h2>
              <Accordion type="single" collapsible className="w-full" data-testid="accordion-faq">
                <AccordionItem value="q1" data-testid="faq-item-0">
                  <AccordionTrigger data-testid="faq-trigger-0">Do I have to switch processors to get the breakdown?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-0">
                    No. The statement review is how we prove your real cost. You keep the breakdown either way - no strings attached. Many merchants use it to have a more informed conversation with their current processor.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q2" data-testid="faq-item-1">
                  <AccordionTrigger data-testid="faq-trigger-1">Is my statement secure?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-1">
                    Yes. Upload a PDF or photo. Redact account numbers if you want - totals and fee lines are all we need. We never store full card numbers, SSNs, or bank account numbers.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q3" data-testid="faq-item-2">
                  <AccordionTrigger data-testid="faq-trigger-2">How fast do I get results?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-2">
                    Most reviews are completed during business hours the same day. If you need priority turnaround,{" "}
                    <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium">book a 10-minute call</a>{" "}
                    and let us know your timeline.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q4" data-testid="faq-item-3">
                  <AccordionTrigger data-testid="faq-trigger-3">What if I don't have my statement handy?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-3">
                    Use our <a href="/estimate" className="text-primary font-medium underline">Quick Estimate tool</a> to get a rough effective rate right now. For the complete picture with line-item detail, upload a statement when you have it.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q5" data-testid="faq-item-4">
                  <AccordionTrigger data-testid="faq-trigger-4">I'm on Square or Stripe. Can you still help?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-4">
                    Absolutely. We'll compare apples-to-apples using your actual numbers. Many businesses processing over $10k/month find that flat-rate pricing costs significantly more than interchange-plus. <a href="/beat-square-stripe" className="text-primary font-medium underline">See the comparison</a>.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q6" data-testid="faq-item-5">
                  <AccordionTrigger data-testid="faq-trigger-5">Is "0% processing" actually legal?</AccordionTrigger>
                  <AccordionContent data-testid="faq-content-5">
                    "0%" programs have rules. We only recommend compliant cash discount or surcharging programs where permitted by law and appropriate for your business model. We handle disclosures, receipt formatting, and staff scripts. <a href="/0-percent-processing" className="text-primary font-medium underline">Learn more</a>.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </section>

        {/* Compare by Processor — crawlable internal link row */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 border-t border-border" data-testid="section-compare-links">
          <p className="text-sm text-muted-foreground mb-3 font-medium">Compare by processor:</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/compare/square" className="text-primary hover:underline" data-testid="link-compare-square">Liberty vs Square</Link>
            <Link href="/compare/stripe" className="text-primary hover:underline" data-testid="link-compare-stripe">Liberty vs Stripe</Link>
            <Link href="/compare/clover" className="text-primary hover:underline" data-testid="link-compare-clover">Liberty vs Clover</Link>
            <Link href="/compare/toast" className="text-primary hover:underline" data-testid="link-compare-toast">Liberty vs Toast</Link>
            <Link href="/compare/paypal" className="text-primary hover:underline" data-testid="link-compare-paypal">Liberty vs PayPal</Link>
          </div>
        </div>

        {/* SECTION 11.5: Quick Callback Form */}
        <section className="bg-background bg-grid py-12 md:py-20 pb-safe-mobile" data-testid="section-callback">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-callback-heading">
                  Prefer a Quick Call?
                </h2>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  Not ready to upload? No problem. Leave your number and a Liberty advisor will call you back - no pitch, just answers.
                </p>
                <div className="space-y-3 mb-6">
                  {[
                    "10 minutes or less",
                    "Real person, not a call center",
                    "No obligation, no follow-up pressure",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-foreground">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Or call us directly: <a href={PHONE_TEL} className="text-primary font-medium" data-testid="link-callback-phone" onClick={() => trackPhoneCtaClick({ page: "/", ctaLabel: PHONE_NUMBER, ctaLocation: "callback" })}>{PHONE_NUMBER}</a>
                </p>
              </div>
              <div>
                {cbSubmitted ? (
                  <Card className="border-2 border-emerald-200 dark:border-emerald-800">
                    <CardContent className="p-8 text-center">
                      <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                      <h3 className="text-xl font-display font-bold text-foreground mb-2" data-testid="text-callback-success">We'll Call You Back</h3>
                      <p className="text-muted-foreground text-sm">A Liberty advisor will reach out during your preferred window. No pressure, just answers.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-6 space-y-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="cb-name">Your Name</label>
                        <Input id="cb-name" placeholder="First and Last" value={cbName} onChange={(e) => setCbName(e.target.value)} data-testid="input-callback-name" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="cb-phone">Phone Number</label>
                        <Input id="cb-phone" type="tel" placeholder="(555) 123-4567" value={cbPhone} onChange={(e) => setCbPhone(e.target.value)} data-testid="input-callback-phone" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1.5 block">Best Time to Call</label>
                        <div className="grid grid-cols-3 gap-2">
                          {["Morning", "Afternoon", "Evening"].map((time) => (
                            <Button
                              key={time}
                              variant={cbBestTime === time ? "default" : "outline"}
                              size="sm"
                              onClick={() => setCbBestTime(time)}
                              className="toggle-elevate"
                              data-testid={`button-callback-time-${time.toLowerCase()}`}
                            >
                              {time}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <PewcCheckbox
                        checked={cbPewcConsent}
                        onCheckedChange={setCbPewcConsent}
                        id="cb-pewc-consent"
                      />
                      <Button className="w-full gap-2" onClick={handleCallbackSubmit} disabled={cbSubmitting || !cbName.trim() || !cbPhone.trim()} data-testid="button-callback-submit">
                        {cbSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                        Request a Callback
                      </Button>
                      <p className="text-xs text-muted-foreground text-center">
                        By submitting, you agree to be contacted by Liberty Bancard. Consent is not required for service.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 11.75: No Lock-in Callout */}
        <section className="section-warm py-12" data-testid="section-no-lockin">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-md mb-4">
                <HandshakeIcon className="w-3.5 h-3.5" />
                No Long-Term Commitment
              </div>
              <h2 className="text-2xl font-display font-bold text-foreground mb-3" data-testid="text-no-lockin-heading">
                Cancel Anytime. No Early Termination Fee. No Penalty.
              </h2>
              <p className="text-muted-foreground mb-4 max-w-xl mx-auto" data-testid="text-no-lockin-body">
                We earn your business every month. No lock-in, no cancellation fees, no penalty for leaving. We're confident in the math — you should be too.
              </p>
              <Link href="/terms" className="text-sm text-primary underline font-medium" data-testid="link-no-lockin-terms">
                Review the merchant terms →
              </Link>
            </div>
          </div>
        </section>

        {/* SECTION 12: Final CTA — sharp navy block */}
        <section className="reveal relative overflow-hidden bg-primary pt-14 pb-20 md:py-24" data-testid="section-final-cta">
          <div className="pointer-events-none absolute inset-0 ledger-texture opacity-[0.12]" aria-hidden="true" />
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent" aria-hidden="true" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
              <div>
                <span className="num text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300/90">Liberty Statement Review</span>
                <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 mt-3" data-testid="text-final-cta-heading">
                  Your Statement Tells the Truth. Let's Read It Together.
                </h2>
                <p className="text-white/70 mb-6 max-w-xl">
                  30 seconds to upload. Most reviews finish the same business day. You keep the breakdown no matter what.
                </p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/75">
                  <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-sky-300" /> No obligation</span>
                  <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-sky-300" /> No contract to see your numbers</span>
                  <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-sky-300" /> Yours to keep</span>
                </div>
              </div>
              <div className="rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm p-6 sm:p-8">
                <div className="flex items-center justify-between gap-3 mb-5">
                  <span className="text-sm font-semibold text-white">Start your review</span>
                  <span className="audit-stamp bg-white/10 text-sky-200 border-white/20">Free</span>
                </div>
                <div className="flex flex-col gap-3">
                  <Link href="/upload-statement" data-testid="link-final-upload">
                    <Button size="lg" className="w-full gap-2 bg-accent hover:bg-accent border-accent text-white" onClick={() => trackStatementUploadCtaClick({ page: "/", ctaLabel: "Get My Free Analysis", ctaLocation: "final-cta" })}>
                      <Upload className="w-4 h-4" />
                      Get My Free Analysis
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Link href="/get-started" data-testid="link-final-quiz">
                    <Button size="lg" variant="outline" className="w-full gap-2 bg-transparent border-white/30 text-white hover:bg-white/10">
                      Take the 60-Second Quiz
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
                <p className="text-xs text-white/50 mt-5" data-testid="text-final-cta-microcopy">
                  Eligibility, underwriting, card brand rules, and applicable laws apply.
                </p>
              </div>
            </div>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}
