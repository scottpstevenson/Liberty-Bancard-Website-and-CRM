import { useState, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
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
  TrendingDown,
  Clock,
  DollarSign,
  AlertTriangle,
  Zap,
  Users,
  BadgeCheck,
  Phone,
} from "lucide-react";
import logoBlue from "@assets/logo-blue.png";

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
      <Navbar />

      <main className="flex-grow pt-28">

        {/* SECTION 1: Social Proof Bar */}
        <section className="bg-primary text-primary-foreground" data-testid="section-proof-bar">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm font-medium">
              <span className="flex items-center gap-1.5" data-testid="text-proof-1"><BadgeCheck className="w-4 h-4" /> Statement-Based Reviews</span>
              <span className="flex items-center gap-1.5" data-testid="text-proof-2"><FileText className="w-4 h-4" /> Line-Item Breakdowns</span>
              <span className="flex items-center gap-1.5" data-testid="text-proof-3"><DollarSign className="w-4 h-4" /> Wholesale Pricing</span>
              <span className="flex items-center gap-1.5" data-testid="text-proof-4"><Zap className="w-4 h-4" /> Next-Day Funding*</span>
              <span className="flex items-center gap-1.5" data-testid="text-proof-5"><Headphones className="w-4 h-4" /> Real Human Support</span>
            </div>
            <p className="text-center text-xs text-primary-foreground/50 mt-1.5" data-testid="text-proof-bar-footnote">
              *Eligibility, underwriting, card brand rules, and applicable laws apply.
            </p>
          </div>
        </section>

        {/* SECTION 2: Hero */}
        <section className="bg-background py-20 lg:py-28" data-testid="section-hero">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-primary/5 text-primary text-sm font-medium px-3 py-1.5 rounded-md mb-6" data-testid="text-hero-badge">
                  <TrendingDown className="w-4 h-4" />
                  Free statement review. Keep the breakdown even if you don't switch.
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-foreground leading-tight mb-6" data-testid="text-hero-heading">
                  You're Not Paying a "Rate."<br />You're Paying a <span className="text-primary">Markup</span> You've Never Seen.
                </h1>
                <p className="text-lg text-muted-foreground mb-4 leading-relaxed" data-testid="text-hero-subheadline">
                  Your processor quoted you a rate. But your actual cost is buried in interchange downgrades, monthly add-ons, PCI fees, and batch charges you've never been shown.
                </p>
                <p className="text-lg text-muted-foreground mb-8 leading-relaxed font-medium" data-testid="text-hero-subheadline-2">
                  We pull it apart line-by-line and show you exactly where your money goes.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                  <Link href="/upload-statement" data-testid="link-hero-upload">
                    <Button size="lg" className="gap-2">
                      <Upload className="w-4 h-4" />
                      Upload Statement - Free Review
                    </Button>
                  </Link>
                  <Link href="/get-started" data-testid="link-hero-quiz">
                    <Button size="lg" variant="outline" className="gap-2">
                      Not Sure Where to Start?
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground mt-4 max-w-md" data-testid="text-hero-microcopy">
                  PDF or photo. 30 seconds. Redact account numbers if you want - we only need totals + fee lines.
                </p>
              </div>

              <div className="relative flex items-center justify-center" data-testid="hero-visual">
                <div className="w-full max-w-sm">
                  <Card className="border-2">
                    <CardContent className="p-6 space-y-4">
                      <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">What a review reveals</div>
                      <div className="space-y-3">
                        {[
                          { label: "Your real effective rate", value: "3.47%", flag: true },
                          { label: "Hidden monthly fees", value: "$127/mo", flag: true },
                          { label: "Interchange downgrades", value: "23% of volume", flag: true },
                          { label: "Potential annual reduction*", value: "$4,200+", flag: false },
                        ].map((item, i) => (
                          <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                            <span className="text-sm text-foreground">{item.label}</span>
                            <span className={`text-sm font-semibold ${item.flag ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>{item.value}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground">*Illustrative example. Actual results depend on statement review. No savings claims without review.</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: Pain Points */}
        <section className="bg-muted/30 py-16" data-testid="section-pain">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-10" data-testid="text-pain-heading">
              Sound Familiar?
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: AlertTriangle, text: "You were quoted 1.5% but your statement shows 3%+", color: "text-red-500" },
                { icon: DollarSign, text: "Monthly fees keep creeping up and nobody explains why", color: "text-amber-500" },
                { icon: Clock, text: "Deposits are unpredictable and you can't plan cash flow", color: "text-orange-500" },
                { icon: Phone, text: "You call support and get a call center, not an answer", color: "text-red-500" },
              ].map((item, i) => (
                <Card key={i} data-testid={`card-pain-${i}`}>
                  <CardContent className="p-5 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <item.icon className={`w-5 h-5 ${item.color}`} />
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{item.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-center text-muted-foreground mt-8 text-sm" data-testid="text-pain-resolution">
              If any of this sounds right, your statement will tell us exactly what's going on.
            </p>
          </div>
        </section>

        {/* SECTION 4: What You Get */}
        <section className="bg-background py-20" data-testid="section-what-you-get">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div>
                <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-what-you-get-heading">
                  What You Get From a Liberty Statement Review
                </h2>
                <p className="text-muted-foreground mb-8">Not a quote. Not a pitch. A clear breakdown of what you're paying and why.</p>
                <ul className="space-y-5 mb-8">
                  {[
                    { title: "Your true effective rate", desc: "Total fees divided by total volume. The one number that tells the truth." },
                    { title: "Every cost driver identified", desc: "Card mix, downgrades, monthly add-ons, batch fees, PCI charges - all of it." },
                    { title: "2-3 clear options with real math", desc: "Apples-to-apples comparison. No vague promises or bait-and-switch." },
                    { title: "Funding timeline clarity", desc: "When your money hits your account and what affects timing.*" },
                    { title: "Implementation plan", desc: "Terminal setup, onboarding steps, and ongoing support - mapped out." },
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3" data-testid={`what-you-get-bullet-${i}`}>
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                      <div>
                        <span className="text-foreground font-medium">{item.title}</span>
                        <p className="text-sm text-muted-foreground mt-0.5">{item.desc}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="lg:sticky lg:top-32">
                <Card className="border-2 border-primary/20">
                  <CardContent className="p-6 text-center">
                    <ShieldCheck className="w-10 h-10 text-primary mx-auto mb-4" />
                    <h3 className="text-xl font-display font-bold text-foreground mb-2" data-testid="text-keep-breakdown">You Keep the Breakdown</h3>
                    <p className="text-muted-foreground text-sm mb-6">Even if you don't switch. Zero obligation. It's yours - use it to negotiate with your current processor if you want.</p>
                    <Link href="/upload-statement" data-testid="link-what-you-get-upload">
                      <Button className="w-full gap-2">
                        <Upload className="w-4 h-4" />
                        Get My Free Breakdown
                      </Button>
                    </Link>
                    <p className="text-xs text-muted-foreground mt-3">*Eligibility, underwriting, card brand rules, and applicable laws apply.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 5: How It Works */}
        <section className="bg-muted/30 py-20" data-testid="section-how-it-works">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-4" data-testid="text-how-heading">
              Three Steps. No Guesswork.
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">Upload your statement. We do the math. You make the call.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { step: "1", icon: Upload, title: "Upload Your Statement", desc: "PDF or photo. Takes 30 seconds. Redact account numbers if you want.", cta: "Upload Now", href: "/upload-statement" },
                { step: "2", icon: Calculator, title: "We Break It Down", desc: "Line-item review of every fee, markup, and cost driver on your statement.", cta: null, href: null },
                { step: "3", icon: FileText, title: "You Get Options", desc: "2-3 clear paths forward with real numbers. Keep the breakdown either way.", cta: null, href: null },
              ].map((item, i) => (
                <div key={i} className="relative" data-testid={`step-${item.step}`}>
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-4 text-xl font-bold">
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
          </div>
        </section>

        {/* SECTION 6: Enhanced Rate Calculator */}
        <section className="bg-background py-20" data-testid="section-calculator">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div>
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
                    <div className="grid grid-cols-3 gap-2">
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
                      <CardContent className="p-6">
                        <div className="text-center mb-4">
                          <div className="text-sm text-muted-foreground mb-1">Your Effective Rate</div>
                          <div className={`text-5xl font-display font-bold ${rateGrade?.color}`} data-testid="display-effective-rate">
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
                    <p className="text-[10px] text-muted-foreground text-center">
                      This calculator provides an estimate only. Upload your statement for a precise, line-item analysis. Eligibility, underwriting, card brand rules, and applicable laws apply.
                    </p>
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Calculator className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                      <h3 className="text-lg font-display font-semibold text-foreground mb-2" data-testid="text-calculator-empty">Enter Your Numbers</h3>
                      <p className="text-sm text-muted-foreground">
                        Plug in your monthly volume and total fees from your last statement. We'll instantly calculate your effective rate and compare it against your industry.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 7: Choose Your Path */}
        <section className="bg-muted/30 py-20" data-testid="section-choose-path">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-4" data-testid="text-choose-path-heading">
              Choose the Strategy That Fits
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">Every business is different. Here are the most common paths our merchants take.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="relative overflow-visible" data-testid="card-wholesale">
                <div className="absolute -top-3 left-4">
                  <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-md">Most Popular</span>
                </div>
                <CardHeader className="gap-1">
                  <CardTitle className="text-lg">Wholesale / Interchange-Plus</CardTitle>
                  <CardDescription>See every penny of markup. Pay interchange + a transparent fee.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Real interchange passthrough</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> No bundled "qualified" tiers</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Full cost transparency</li>
                  </ul>
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

              <Card data-testid="card-zero-percent">
                <CardHeader className="gap-1">
                  <CardTitle className="text-lg">Compliant 0% Programs*</CardTitle>
                  <CardDescription>Pass fees to the cardholder where permitted by law and card brand rules.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Cash discount or surcharging</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Proper disclosures + receipts</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Staff scripts included</li>
                  </ul>
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

              <Card data-testid="card-terminal">
                <CardHeader className="gap-1">
                  <CardTitle className="text-lg">Liberty Smart Terminal</CardTitle>
                  <CardDescription>Dejavoo QD4. Modern checkout with guided onboarding and support.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Tap, dip, swipe, manual key</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Free for qualifying merchants*</li>
                    <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Same-day setup available</li>
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
        <section className="bg-background py-20" data-testid="section-verticals">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-verticals-heading">
                Built for Operators Who Run Real Businesses
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">South Florida roots. Nationwide reach. We know the cost pressures in your industry.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { icon: Stethoscope, title: "Medical / Dental / Medspa", points: ["Front desk speed and deposit clarity", "Fewer billing headaches", "HIPAA-aware workflows"] },
                { icon: Car, title: "Automotive", points: ["High-ticket transaction handling", "Predictable funding schedules", "Chargeback prevention"] },
                { icon: UtensilsCrossed, title: "Restaurants", points: ["Fast tip-adjusted checkout", "Reliable terminals that don't freeze", "Weekend support when you need it"] },
                { icon: Wrench, title: "Home Services", points: ["Mobile acceptance on the job", "Cash flow-focused funding", "Simple invoicing support"] },
                { icon: Store, title: "Retail", points: ["Fast checkout lines", "Modern tap + contactless", "Inventory-friendly integrations"] },
                { icon: Users, title: "Other Industries", points: ["We've seen every vertical", "The math is the math", "Upload and we'll tailor your review"] },
              ].map((item, i) => (
                <Card key={i} data-testid={`card-vertical-${i}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <item.icon className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="font-display font-semibold text-foreground">{item.title}</h3>
                    </div>
                    <ul className="space-y-1.5">
                      {item.points.map((point, j) => (
                        <li key={j} className="text-sm text-muted-foreground flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 9: Social Proof / Reviews */}
        <section className="bg-muted/30 py-20" data-testid="section-reviews">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-4" data-testid="text-reviews-heading">
              Merchants Don't Want a "Processor." They Want a Partner.
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">Here's what business owners say after their first statement review.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { quote: "We finally saw our real effective rate. The breakdown was clear, the switch was smooth, and we had a direct line for questions.", author: "Retail Owner, Boca Raton", stars: 5 },
                { quote: "Support actually answered when we needed it. No ticket loop, no waiting 3 days for a callback. This is how it should work.", author: "Automotive Shop Manager", stars: 5 },
                { quote: "They gave us options instead of pressure. We chose the lowest-friction route and saved real money on our monthly processing.", author: "Medical Office Manager, Fort Lauderdale", stars: 5 },
              ].map((review, i) => (
                <Card key={i} data-testid={`card-review-${i}`}>
                  <CardContent className="p-6">
                    <div className="flex gap-0.5 mb-3">
                      {Array.from({ length: review.stars }).map((_, j) => (
                        <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                    <Quote className="w-6 h-6 text-primary/20 mb-2" />
                    <p className="text-sm text-foreground mb-4 leading-relaxed">{review.quote}</p>
                    <span className="text-xs font-medium text-muted-foreground">- {review.author}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 10: Trust / Risk Reversal */}
        <section className="bg-background py-20" data-testid="section-risk-reversal">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <ShieldCheck className="w-14 h-14 text-primary mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6" data-testid="text-risk-reversal-heading">
                Proof First. Pressure Never.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-4" data-testid="text-risk-reversal-body-1">
                We don't ask you to sign anything to get a statement review. We don't lock you into a contract to see your numbers. And if we can't find a meaningful improvement, we'll tell you.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-8" data-testid="text-risk-reversal-body-2">
                You keep the line-item breakdown either way. Use it to negotiate with your current processor, share it with your accountant, or just understand what you're paying for the first time.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                {[
                  { icon: FileText, label: "No contract required" },
                  { icon: ShieldCheck, label: "Keep the breakdown" },
                  { icon: Scale, label: "Zero obligation" },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center gap-2" data-testid={`trust-signal-${i}`}>
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <item.icon className="w-6 h-6 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 11: FAQ */}
        <section className="bg-muted/30 py-20" data-testid="section-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
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
                    Most reviews are completed during business hours the same day. If you need priority turnaround, book a 10-minute call and let us know your timeline.
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

        {/* SECTION 12: Final CTA */}
        <section className="bg-primary text-primary-foreground py-20" data-testid="section-final-cta">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4" data-testid="text-final-cta-heading">
              Your Statement Tells the Truth. Let's Read It Together.
            </h2>
            <p className="text-primary-foreground/70 mb-8 max-w-xl mx-auto">
              30 seconds to upload. Same-day review. You keep the breakdown no matter what.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-final-upload">
                <Button size="lg" variant="secondary" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload My Statement
                </Button>
              </Link>
              <Link href="/get-started" data-testid="link-final-quiz">
                <Button size="lg" variant="outline" className="gap-2 bg-transparent border-primary-foreground/30 text-primary-foreground">
                  Take the 60-Second Quiz
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
            <p className="text-xs text-primary-foreground/50 mt-6" data-testid="text-final-cta-microcopy">
              Eligibility, underwriting, card brand rules, and applicable laws apply.
            </p>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}
