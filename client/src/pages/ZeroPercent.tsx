import { SEO, getFAQSchema, getServiceSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Scale,
  FileCheck,
  Phone,
  DollarSign,
  ArrowRight,
  BadgeCheck,
  Store,
  Stethoscope,
  UtensilsCrossed,
  Wrench,
  Car,
  Users,
  Receipt,
  MessageSquare,
  Zap,
} from "lucide-react";
import { PHONE_TEL, PHONE_NUMBER, CALENDAR_URL } from "@/lib/constants";
import { trackCashDiscountReviewClick, trackSurchargeReviewClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import imgCloverFlex3 from "@assets/images/terminal-clover-flex-3.png";
import imgPaxA920 from "@assets/images/terminal-pax-a920.png";

const faqItems = [
  {
    question: 'Is Liberty Zero the same as "surcharging"?',
    answer:
      'Liberty Zero is a branded name for our compliant fee-offset programs. The two legal structures are cash discount (a discount for cash-paying customers) and compliant surcharging (a disclosed fee on eligible credit transactions where state law permits). We recommend the right fit for your business.',
  },
  {
    question: "Does Liberty Zero apply to debit cards?",
    answer:
      "Debit cards have different rules under card brand guidelines. We configure the correct treatment automatically — debit transactions are handled properly so you stay compliant without any manual workarounds.",
  },
  {
    question: "Will customers push back?",
    answer:
      "With clear signage, proper receipt formatting, and a one-sentence staff script (which we provide), most merchants report minimal friction. Transparency is the key — customers who see the pricing upfront rarely complain.",
  },
  {
    question: "Is it allowed in my state?",
    answer:
      "Cash discount programs are legal in all 50 states. Surcharging is permitted in most states with proper disclosures, but a few states have restrictions. We verify the right approach for your location before recommending anything.",
  },
  {
    question: "What businesses qualify for Liberty Zero?",
    answer:
      "Most brick-and-mortar businesses qualify — restaurants, retail, medical, auto repair, salons, and service businesses are common fits. E-commerce merchants may qualify depending on volume and card type mix. We review your statement to confirm.",
  },
  {
    question: "What does the math actually look like?",
    answer:
      "If you process $10,000/month in card volume and currently pay $250-$350 in fees, Liberty Zero could bring that to $0 in processor fees. The service fee (typically 3-4%) is collected from the card-paying customer at checkout, not deducted from your revenue.",
  },
];

const complianceItems = [
  { icon: Store, title: "Compliant Signage", desc: "Point-of-sale signage with required disclosures, pre-printed and ready to display. Wording meets card brand guidelines." },
  { icon: Receipt, title: "Receipt Formatting", desc: "Receipts automatically show the cash price and card price as required. No manual adjustments, no compliance gaps." },
  { icon: MessageSquare, title: "Staff Script", desc: "One sentence. We provide it. 'Cash price is X, card price is Y — how would you like to pay?' That's all your team needs." },
  { icon: ShieldCheck, title: "Card Brand Registration", desc: "For surcharging programs, we handle required registration with Visa and Mastercard so you're covered from day one." },
];

const qualifyingBusinessTypes = [
  { icon: UtensilsCrossed, label: "Restaurants & Cafes" },
  { icon: Store, label: "Retail Stores" },
  { icon: Stethoscope, label: "Medical & Dental" },
  { icon: Car, label: "Auto Repair" },
  { icon: Wrench, label: "Home Services" },
  { icon: Users, label: "Professional Services" },
];

export default function ZeroPercent() {
  const containerRef = useScrollReveal();
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title="Liberty Zero — Pay $0 to Accept Credit Cards"
        description="Liberty Zero eliminates credit card processing costs for qualifying merchants. Compliant cash discount and surcharging programs handled the right way."
        path="/0-percent-processing"
        keywords="liberty zero, 0% processing, cash discount program, surcharging, zero cost processing, compliant surcharge, pay zero to accept cards"
        breadcrumbs={[{ name: "Liberty Zero", path: "/0-percent-processing" }]}
        structuredData={[getFAQSchema(faqItems), getServiceSchema("Liberty Zero — 0% Processing Program", "Compliant cash discount and surcharge programs that eliminate credit card processing fees for qualifying merchants.", "/0-percent-processing")]}
      />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>

        {/* SECTION 1: Hero — The Promise */}
        <section className="relative overflow-hidden" data-testid="section-zero-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="glow-blob glow-blob-2 w-48 h-48 bg-blue-600 bottom-10 left-1/4" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-emerald-500/20 text-emerald-300 text-sm font-semibold px-3 py-1.5 rounded-md mb-6 border border-emerald-500/30" data-testid="badge-liberty-zero-hero">
                  <Zap className="w-4 h-4" />
                  Liberty Zero™ Program
                </div>
                <h1
                  className="text-4xl md:text-5xl font-display font-bold text-white leading-tight mb-6"
                  data-testid="text-zero-heading"
                >
                  Stop Paying to Process Cards.<br /><span className="text-sky-400">We'll find your legal path to zero fees — and keep you compliant.</span>
                </h1>
                <p
                  className="text-lg text-white/75 mb-4 leading-relaxed"
                  data-testid="text-zero-subheadline"
                >
                  We determine if <strong className="text-white/90">cash discount</strong> or <strong className="text-white/90">compliant surcharging</strong> is legally sound for your specific state, handle every regulatory requirement, and implement the right solution. If neither program fits, we'll cut your current rates with a transparent Interchange Plus plan instead.
                </p>
                <p className="text-lg text-white/90 font-medium mb-8" data-testid="text-zero-wallet-impact">
                  For a merchant processing $10,000/month, that's $250–$350 back in your pocket. Every month.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                  <Link
                    href="/upload-statement"
                    data-testid="link-zero-primary-cta"
                    onClick={() => trackCashDiscountReviewClick({ page: "/0-percent-processing", ctaLabel: "Check Eligibility" })}
                  >
                    <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                      <Upload className="w-4 h-4" />
                      Check Eligibility — Free Review
                    </Button>
                  </Link>
                  <a href={PHONE_TEL} data-testid="link-zero-secondary-cta" onClick={() => trackPhoneCallClick({ sourcePage: "/0-percent-processing" })}>
                    <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                      <Phone className="w-4 h-4" />
                      Talk to a Specialist
                    </Button>
                  </a>
                </div>
                <p
                  className="text-sm text-white/60 mt-4 max-w-lg"
                  data-testid="text-zero-abovefold-disclaimer"
                >
                  Program availability depends on business type, state rules, card-network rules, disclosure requirements, and underwriting.
                </p>
                <p
                  className="text-xs text-white/40 mt-2"
                  data-testid="text-zero-microcopy"
                >
                  Eligibility confirmed via statement review.
                </p>
              </div>

              <div className="flex items-center justify-center" data-testid="hero-visual-zero">
                <Card className="w-full max-w-sm border border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
                  <CardContent className="p-6 space-y-4">
                    <div className="text-sm font-medium text-white/60 uppercase tracking-wider">$10,000/month in card volume</div>
                    <div className="space-y-3">
                      {[
                        { label: "Current processing cost", value: "$300/mo", flag: true },
                        { label: "With Liberty Zero", value: "$0/mo", flag: false },
                        { label: "Monthly savings", value: "$300", flag: false },
                        { label: "Annual savings", value: "$3,600+", flag: false },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between py-2 border-b border-white/10 last:border-0">
                          <span className="text-sm text-white/80">{item.label}</span>
                          <span className={`text-sm font-semibold ${item.flag ? "text-red-400" : "text-emerald-400"}`}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-white/30">*Illustrative example. Actual results depend on statement review and eligibility.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        <div className="bg-muted/50 border-b border-border py-3" data-testid="section-trust-strip">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Secure statement review</span>
              <span className="flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-sky-500" /> No obligation comparison</span>
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-primary" /> Transparent rate analysis</span>
              <span className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-primary" /> Merchant-focused payment review</span>
              <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-500" /> Eligibility confirmed via statement review</span>
            </div>
          </div>
        </div>

        {/* SECTION 2: How It Works */}
        <section className="bg-muted bg-dots py-20" data-testid="section-how-it-works">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-how-heading">
                Two Ways to Eliminate Your Card Processing Cost
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Cash discount and compliant surcharging are different programs with different rules — the right one depends on your state, card mix, and customer type. We make the recommendation and handle the compliance. Here's how each works.
              </p>
            </div>
            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              <Card data-testid="card-approach-cash-discount">
                <CardContent className="p-8">
                  <div className="w-12 h-12 rounded-md bg-emerald-500/10 flex items-center justify-center mb-4">
                    <Scale className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-xl font-display font-bold text-foreground">Cash Discount</h3>
                    <Badge variant="secondary" className="text-xs">All 50 States</Badge>
                  </div>
                  <p className="text-muted-foreground mb-4 leading-relaxed">
                    Your posted price is the "cash price." Customers who pay by card see a slightly higher price — the difference covers processing. Customers who pay cash get the standard price as a discount.
                  </p>
                  <p className="text-sm font-medium text-foreground mb-4">Best for: Retail, restaurants, service businesses</p>
                  <Link
                    href="/upload-statement"
                    className="text-sm text-primary underline"
                    data-testid="link-cash-discount-review"
                    onClick={() => trackCashDiscountReviewClick({ page: "/0-percent-processing", ctaLabel: "See My Cash Discount Savings" })}
                  >
                    See My Cash Discount Savings →
                  </Link>
                </CardContent>
              </Card>

              <Card data-testid="card-approach-surcharge">
                <CardContent className="p-8">
                  <div className="w-12 h-12 rounded-md bg-sky-500/10 flex items-center justify-center mb-4">
                    <ShieldCheck className="w-6 h-6 text-sky-600" />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-xl font-display font-bold text-foreground">Compliant Surcharging</h3>
                    <Badge variant="secondary" className="text-xs">Most States</Badge>
                  </div>
                  <p className="text-muted-foreground mb-4 leading-relaxed">
                    A disclosed service fee is added to eligible credit card transactions at checkout. State law and card brand rules govern where this applies. We verify eligibility before recommending this path.
                  </p>
                  <p className="text-sm font-medium text-foreground mb-4">Best for: Higher-ticket B2B, professional services</p>
                  <Link
                    href="/upload-statement"
                    className="text-sm text-primary underline"
                    data-testid="link-surcharge-review"
                    onClick={() => trackSurchargeReviewClick({ page: "/0-percent-processing", ctaLabel: "Check My Surcharging Eligibility" })}
                  >
                    Check My Surcharging Eligibility →
                  </Link>
                </CardContent>
              </Card>
            </div>

            <div className="reveal mt-10 max-w-2xl mx-auto">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-6">
                  <p className="text-center text-sm text-foreground font-medium">
                    <BadgeCheck className="w-4 h-4 text-primary inline mr-2" />
                    Not sure which structure fits? Upload your statement and we'll analyze your card mix, ticket size, and state rules — then recommend the right path.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* SECTION 3: Who Qualifies */}
        <section className="bg-background bg-grid py-20" data-testid="section-who-qualifies">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-qualify-heading">
                Is This a Good Fit for Your Business?
              </h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                These programs work best when your customers are not extremely price-sensitive, your average ticket is reasonable, and your state allows the program. Upload your statement and we verify eligibility — you don't guess.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-10">
                {qualifyingBusinessTypes.map((biz, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50" data-testid={`qualify-biz-${i}`}>
                    <biz.icon className="w-5 h-5 text-primary shrink-0" />
                    <span className="text-sm font-medium text-foreground">{biz.label}</span>
                  </div>
                ))}
              </div>

              <h3 className="text-xl font-display font-semibold text-foreground mb-4">Eligibility checklist</h3>
              <ul className="space-y-3 mb-8">
                {[
                  "Business located in an eligible state (confirmed before enrollment)",
                  "Processing volume of $5,000+/month in card transactions",
                  "Customers are not extremely price-sensitive (B2C or B2B)",
                  "Average ticket high enough that a disclosed service fee isn't disruptive",
                  "Staff can follow a one-sentence checkout script (provided by Liberty)",
                  "Debit card percentage of volume is understood and handled correctly",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`qualify-bullet-${i}`}>
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <Link href="/upload-statement" data-testid="link-qualify-cta">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Check My Eligibility
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* SECTION 4: Compliance — Liberty Handles It All */}
        <section className="bg-muted py-20" data-testid="section-compliance">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-compliance-heading">
                Compliance Is Our Job, Not Yours
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Most providers hand you a brochure and call it a day. Liberty Zero includes everything required to run a fully compliant program — from the first sign to the last receipt.
              </p>
            </div>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto mb-10">
              {complianceItems.map((item, i) => (
                <Card key={i} data-testid={`card-compliance-${i}`}>
                  <CardContent className="p-6 flex items-start gap-4">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-foreground mb-1">{item.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="reveal max-w-4xl mx-auto">
              <h3 className="text-xl font-display font-semibold text-foreground mb-4 text-center">Everything we configure and handle for you</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  "Signage and checkout messaging (card brand compliant)",
                  "Receipt formatting with required dual-price disclosures",
                  "Debit program rules (handled automatically in the terminal)",
                  "Card brand requirements (Visa/MC registration where required)",
                  "Ongoing support as card brand and state rules evolve",
                  "Staff training script — one sentence, we write it",
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-background" data-testid={`compliance-detail-${i}`}>
                    <FileCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span className="text-sm text-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 5: The Math — Real Example */}
        <section className="relative overflow-hidden py-20" data-testid="section-math-example">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-sky-500" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-white mb-4" data-testid="text-math-heading">
                The Math, Plainly
              </h2>
              <p className="text-white/70 max-w-xl mx-auto">
                Here's exactly what Liberty Zero looks like at $10,000/month in card volume — a common volume for restaurants, retail shops, and service businesses.
              </p>
            </div>

            <div className="max-w-3xl mx-auto">
              <Card className="border border-white/10 bg-white/5 backdrop-blur-md mb-8" data-testid="card-math-example">
                <CardContent className="p-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <div className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">WITHOUT Liberty Zero</div>
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm border-b border-white/10 pb-2">
                          <span className="text-white/70">Monthly card volume</span>
                          <span className="text-white font-medium">$10,000</span>
                        </div>
                        <div className="flex justify-between text-sm border-b border-white/10 pb-2">
                          <span className="text-white/70">Effective processing rate</span>
                          <span className="text-red-400 font-medium">~2.7%</span>
                        </div>
                        <div className="flex justify-between text-sm border-b border-white/10 pb-2">
                          <span className="text-white/70">Monthly fees paid</span>
                          <span className="text-red-400 font-semibold">$270</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-white/70">Annual fees paid</span>
                          <span className="text-red-400 font-semibold">$3,240</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-4">WITH Liberty Zero</div>
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm border-b border-white/10 pb-2">
                          <span className="text-white/70">Monthly card volume</span>
                          <span className="text-white font-medium">$10,000</span>
                        </div>
                        <div className="flex justify-between text-sm border-b border-white/10 pb-2">
                          <span className="text-white/70">Service fee collected from card customers</span>
                          <span className="text-white/70 font-medium text-xs">~3% from payer</span>
                        </div>
                        <div className="flex justify-between text-sm border-b border-white/10 pb-2">
                          <span className="text-white/70">Processing fees deducted from your revenue</span>
                          <span className="text-emerald-400 font-semibold">$0</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-white/70">Annual cost to you</span>
                          <span className="text-emerald-400 font-semibold">$0</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 pt-6 border-t border-white/10 text-center">
                    <div className="text-3xl font-display font-bold text-emerald-400 mb-1">$3,240/year saved</div>
                    <p className="text-sm text-white/50">Based on $10,000/month at 2.7% effective rate. Your actual savings depend on your statement.</p>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {[
                  { volume: "$5,000/mo", savings: "~$1,350/yr" },
                  { volume: "$25,000/mo", savings: "~$8,100/yr" },
                  { volume: "$50,000/mo", savings: "~$16,200/yr" },
                ].map((row, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-4 text-center" data-testid={`math-example-${i}`}>
                    <div className="text-sm text-white/60 mb-1">{row.volume} volume</div>
                    <div className="text-xl font-display font-bold text-emerald-400">{row.savings}</div>
                    <div className="text-xs text-white/40 mt-1">potential annual savings</div>
                  </div>
                ))}
              </div>
              <p className="text-center text-xs text-white/30">
                *Illustrative estimates based on ~2.7% effective rate. Actual results depend on your statement, card mix, and underwriting. No savings claims without review.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 6: Implementation & Terminal */}
        <section className="bg-background bg-dots py-20" data-testid="section-terminal-equipment">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-5xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                <div className="flex flex-col gap-4 items-center order-2 md:order-1">
                  <img src={imgCloverFlex3} alt="Clover Flex 3 payment terminal configured for Liberty Zero" className="w-full max-w-xs rounded-md object-contain" data-testid="img-zero-terminal-hero" />
                  <img src={imgPaxA920} alt="PAX A920 smart payment terminal with Liberty Zero" className="w-full max-w-xs rounded-md object-cover" data-testid="img-zero-terminal-tap" />
                </div>
                <div className="order-1 md:order-2">
                  <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-terminal-heading">
                    Ready to Go in 48 Hours
                  </h2>
                  <p className="text-muted-foreground mb-6 leading-relaxed" data-testid="text-terminal-description">
                    Every Liberty Zero deployment is configured directly on your terminal. Dual-pricing, compliant receipts, and disclosures are handled automatically at checkout — no manual math, no workarounds.
                  </p>
                  <ul className="space-y-3 mb-6">
                    {[
                      "Statement review to confirm eligibility and savings",
                      "Program type confirmed (cash discount or surcharge)",
                      "Terminal pre-configured with dual-pricing and signage",
                      "Staff script provided, go-live support included",
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-3" data-testid={`impl-step-${i}`}>
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-primary-foreground text-xs font-bold">{i + 1}</span>
                        </div>
                        <span className="text-muted-foreground text-sm">{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Link href="/upload-statement" data-testid="link-zero-terminal-cta">
                      <Button className="gap-2">
                        <Upload className="w-4 h-4" />
                        Upload Statement
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                    <a href={PHONE_TEL} aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`} data-testid="link-zero-call-cta" onClick={() => trackPhoneCallClick({ sourcePage: "/0-percent-processing" })}>
                      <Button variant="outline" className="gap-2">
                        <Phone className="w-4 h-4" />
                        Call {PHONE_NUMBER}
                      </Button>
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">*Free terminal placement requires approved account and meets minimum processing requirements.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-muted py-20" data-testid="section-zero-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
                data-testid="text-zero-faq-heading"
              >
                Liberty Zero — Common Questions
              </h2>
              <Accordion type="single" collapsible className="w-full">
                {faqItems.map((item, i) => (
                  <AccordionItem
                    key={i}
                    value={`faq-${i}`}
                    data-testid={`faq-item-${i}`}
                  >
                    <AccordionTrigger
                      className="text-left"
                      data-testid={`faq-trigger-${i}`}
                    >
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent data-testid={`faq-content-${i}`}>
                      <p className="text-muted-foreground">{item.answer}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              <div className="mt-8">
                <Link href="/upload-statement" data-testid="link-faq-cta">
                  <Button className="gap-2">
                    <Upload className="w-4 h-4" />
                    Check Eligibility — Free Review
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden py-20" data-testid="section-zero-final-cta">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(221,83%,20%)] to-[hsl(222,47%,8%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-white mb-4"
              data-testid="text-zero-final-cta-heading"
            >
              Ready to Reduce Your Processing Cost to $0?
            </h2>
            <p
              className="text-white/60 mb-8 max-w-2xl mx-auto"
              data-testid="text-zero-final-cta-body"
            >
              Upload your statement and we'll confirm eligibility, show you the math, and set everything up — signage, receipts, and staff scripts included.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-zero-final-upload">
                <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                  <Upload className="w-4 h-4" />
                  Upload Statement — Check Eligibility
                </Button>
              </Link>
              <a href={PHONE_TEL} aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`} data-testid="link-zero-final-call" onClick={() => trackPhoneCallClick({ sourcePage: "/0-percent-processing" })}>
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                  <Phone className="w-4 h-4" />
                  Call {PHONE_NUMBER}
                </Button>
              </a>
            </div>
            <p className="text-xs text-white/30 mt-6 max-w-xl mx-auto">
              Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
