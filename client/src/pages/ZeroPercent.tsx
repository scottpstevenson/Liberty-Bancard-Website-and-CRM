import { SEO, getFAQSchema, getServiceSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { PHONE_TEL, PHONE_NUMBER } from "@/lib/constants";
import { trackCashDiscountReviewClick, trackSurchargeReviewClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import imgCloverFlex3 from "@/assets/images/terminal-clover-flex-3.png";
import imgPaxA920 from "@/assets/images/terminal-pax-a920.png";
import {
  ZP_CASH_DISCOUNT,
  ZP_COSTS,
  ZP_EQUIPMENT,
  ZP_FAQ,
  ZP_FAQ_HEADING,
  ZP_FINAL,
  ZP_FIT,
  ZP_HERO,
  ZP_META,
  ZP_PATH,
  ZP_PROGRAMS_HEADING,
  ZP_PROGRAMS_INTRO,
  ZP_REQUIREMENTS,
  ZP_REVIEW_CARD,
  ZP_SURCHARGE,
  ZP_TRUST_STRIP,
  ZP_UNSURE,
} from "@shared/zero-percent-content";

const faqItems = ZP_FAQ;

const requirementIcons = [Store, Receipt, MessageSquare, ShieldCheck];
const businessTypeIcons = [UtensilsCrossed, Store, Stethoscope, Car, Wrench, Users];
const trustIcons = [
  <ShieldCheck key="0" className="w-3.5 h-3.5 text-emerald-500" />,
  <BadgeCheck key="1" className="w-3.5 h-3.5 text-sky-500" />,
  <Users key="2" className="w-3.5 h-3.5 text-primary" />,
  <DollarSign key="3" className="w-3.5 h-3.5 text-primary" />,
  <Zap key="4" className="w-3.5 h-3.5 text-amber-500" />,
];

export default function ZeroPercent() {
  const containerRef = useScrollReveal();
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={ZP_META.title}
        description={ZP_META.description}
        path={ZP_PATH}
        keywords={ZP_META.keywords}
        breadcrumbs={[{ name: "Liberty Zero", path: ZP_PATH }]}
        structuredData={[getFAQSchema([...faqItems]), getServiceSchema(ZP_META.serviceName, ZP_META.serviceDescription, ZP_PATH)]}
      />
      <Navbar />

      <main className="flex-grow public-main-offset" ref={containerRef}>

        {/* SECTION 1: Hero */}
        <section className="relative overflow-hidden" data-testid="section-zero-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="glow-blob glow-blob-2 w-48 h-48 bg-blue-600 bottom-10 left-1/4" />
          <div className="public-container relative py-10 lg:py-20">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-emerald-500/20 text-emerald-300 text-sm font-semibold px-3 py-1.5 rounded-md mb-6 border border-emerald-500/30" data-testid="badge-liberty-zero-hero">
                  <Zap className="w-4 h-4" />
                  {ZP_HERO.badge}
                </div>
                <h1
                  className="public-h1 font-display font-bold text-white mb-6"
                  data-testid="text-zero-heading"
                >
                  {ZP_HERO.headingLead}<br /><span className="text-sky-400">{ZP_HERO.headingAccent}</span>
                </h1>
                <p
                  className="text-lg text-white/75 mb-8 leading-relaxed"
                  data-testid="text-zero-subheadline"
                >
                  {ZP_HERO.sub}
                </p>
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                  <Button size="lg" className="public-cta gap-2 bg-sky-400 border-sky-400 text-slate-950 hover:bg-sky-300" asChild>
                    <Link href="/upload-statement" data-testid="link-zero-primary-cta" onClick={() => trackCashDiscountReviewClick({ page: ZP_PATH, ctaLabel: "Check Eligibility" })}>
                      <Upload className="w-4 h-4" />
                      {ZP_HERO.cta}
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="public-cta gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white" asChild>
                    <a href={PHONE_TEL} data-testid="link-zero-secondary-cta" onClick={() => trackPhoneCallClick({ sourcePage: ZP_PATH })}>
                      <Phone className="w-4 h-4" />
                      {ZP_HERO.secondaryCta}
                    </a>
                  </Button>
                </div>
                <p
                  className="text-sm text-white/60 mt-4 max-w-lg"
                  data-testid="text-zero-abovefold-disclaimer"
                >
                  {ZP_HERO.disclaimer}
                </p>
                <p
                  className="text-xs text-white/70 mt-2"
                  data-testid="text-zero-microcopy"
                >
                  {ZP_HERO.microcopy}
                </p>
              </div>

              <div className="flex items-center justify-center" data-testid="hero-visual-zero">
                <Card className="w-full max-w-sm border border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
                  <CardContent className="p-6 space-y-4">
                    <div className="text-sm font-medium text-white/60 uppercase tracking-wider">{ZP_REVIEW_CARD.heading}</div>
                    <ul className="space-y-3">
                      {ZP_REVIEW_CARD.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-3 py-2 border-b border-white/10 last:border-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                          <span className="text-sm text-white/80">{item}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-white/70">{ZP_REVIEW_CARD.footnote}</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        <div className="bg-muted/50 border-b border-border py-3" data-testid="section-trust-strip">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
              {ZP_TRUST_STRIP.map((label, i) => (
                <span key={label} className="flex items-center gap-1.5">{trustIcons[i]} {label}</span>
              ))}
            </div>
          </div>
        </div>

        {/* SECTION 2: How It Works */}
        <section className="bg-muted py-10" data-testid="section-how-it-works">
          <div className="public-container">
            <div className="reveal text-center mb-12">
              <h2 className="public-h2 font-display font-bold text-foreground mb-4" data-testid="text-how-heading">
                {ZP_PROGRAMS_HEADING}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {ZP_PROGRAMS_INTRO}
              </p>
            </div>
            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              <Card data-testid="card-approach-cash-discount">
                <CardContent className="p-8">
                  <div className="w-12 h-12 rounded-md bg-emerald-500/10 flex items-center justify-center mb-4">
                    <Scale className="w-6 h-6 text-emerald-700" />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-xl font-display font-bold text-foreground">{ZP_CASH_DISCOUNT.title}</h3>
                    <Badge variant="secondary" className="text-xs">{ZP_CASH_DISCOUNT.badge}</Badge>
                  </div>
                  <p className="text-muted-foreground mb-4 leading-relaxed">
                    {ZP_CASH_DISCOUNT.body}
                  </p>
                  <p className="text-sm font-medium text-foreground mb-4">{ZP_CASH_DISCOUNT.fit}</p>
                  <Link
                    href="/upload-statement"
                    className="text-sm text-primary underline"
                    data-testid="link-cash-discount-review"
                    onClick={() => trackCashDiscountReviewClick({ page: ZP_PATH, ctaLabel: ZP_CASH_DISCOUNT.cta })}
                  >
                    {ZP_CASH_DISCOUNT.cta} →
                  </Link>
                </CardContent>
              </Card>

              <Card data-testid="card-approach-surcharge">
                <CardContent className="p-8">
                  <div className="w-12 h-12 rounded-md bg-sky-500/10 flex items-center justify-center mb-4">
                    <ShieldCheck className="w-6 h-6 text-sky-600" />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-xl font-display font-bold text-foreground">{ZP_SURCHARGE.title}</h3>
                    <Badge variant="secondary" className="text-xs">{ZP_SURCHARGE.badge}</Badge>
                  </div>
                  <p className="text-muted-foreground mb-4 leading-relaxed">
                    {ZP_SURCHARGE.body}
                  </p>
                  <p className="text-sm font-medium text-foreground mb-4">{ZP_SURCHARGE.fit}</p>
                  <Link
                    href="/upload-statement"
                    className="text-sm text-primary underline"
                    data-testid="link-surcharge-review"
                    onClick={() => trackSurchargeReviewClick({ page: ZP_PATH, ctaLabel: ZP_SURCHARGE.cta })}
                  >
                    {ZP_SURCHARGE.cta} →
                  </Link>
                </CardContent>
              </Card>
            </div>

            <div className="reveal mt-10 max-w-2xl mx-auto">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-6">
                  <p className="text-center text-sm text-foreground font-medium">
                    <BadgeCheck className="w-4 h-4 text-primary inline mr-2" />
                    {ZP_UNSURE}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* SECTION 3: Who Qualifies */}
        <section className="bg-background py-10" data-testid="section-who-qualifies">
          <div className="public-container">
            <div className="reveal max-w-3xl mx-auto">
              <h2 className="public-h2 font-display font-bold text-foreground mb-4" data-testid="text-qualify-heading">
                {ZP_FIT.heading}
              </h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                {ZP_FIT.intro}
              </p>

              <h3 className="text-sm font-semibold text-foreground mb-3">{ZP_FIT.businessTypesHeading}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-10">
                {ZP_FIT.businessTypes.map((label, i) => {
                  const Icon = businessTypeIcons[i];
                  return (
                    <div key={label} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50" data-testid={`qualify-biz-${i}`}>
                      <Icon className="w-5 h-5 text-primary shrink-0" />
                      <span className="text-sm font-medium text-foreground">{label}</span>
                    </div>
                  );
                })}
              </div>

              <h3 className="text-xl font-display font-semibold text-foreground mb-4">{ZP_FIT.checklistHeading}</h3>
              <ul className="space-y-3 mb-8">
                {ZP_FIT.checklist.map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`qualify-bullet-${i}`}>
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <Button className="gap-2" asChild>
                <Link href="/upload-statement" data-testid="link-qualify-cta">
                  <Upload className="w-4 h-4" />
                  {ZP_FIT.cta}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* SECTION 4: Requirements reviewed with the merchant */}
        <section className="bg-muted py-10" data-testid="section-compliance">
          <div className="public-container">
            <div className="reveal text-center mb-12">
              <h2 className="public-h2 font-display font-bold text-foreground mb-4" data-testid="text-compliance-heading">
                {ZP_REQUIREMENTS.heading}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {ZP_REQUIREMENTS.intro}
              </p>
            </div>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto mb-10">
              {ZP_REQUIREMENTS.cards.map((item, i) => {
                const Icon = requirementIcons[i];
                return (
                  <Card key={item.title} data-testid={`card-compliance-${i}`}>
                    <CardContent className="p-6 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-display font-bold text-foreground mb-1">{item.title}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="reveal max-w-4xl mx-auto">
              <h3 className="text-xl font-display font-semibold text-foreground mb-4 text-center">{ZP_REQUIREMENTS.listHeading}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ZP_REQUIREMENTS.list.map((item, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-background" data-testid={`compliance-detail-${i}`}>
                    <FileCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span className="text-sm text-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 5: Reading your own numbers (no dollar figures without a statement) */}
        <section className="relative overflow-hidden py-10" data-testid="section-math-example">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-sky-500" />
          <div className="public-container relative">
            <div className="text-center mb-12">
              <h2 className="public-h2 font-display font-bold text-white mb-4" data-testid="text-math-heading">
                {ZP_COSTS.heading}
              </h2>
              <p className="text-white/70 max-w-2xl mx-auto">
                {ZP_COSTS.intro}
              </p>
            </div>

            <div className="max-w-4xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {ZP_COSTS.cards.map((card, i) => (
                  <div key={card.title} className="bg-white/5 border border-white/10 rounded-lg p-5" data-testid={`math-example-${i}`}>
                    <div className="text-sm font-semibold text-white mb-2">{card.title}</div>
                    <div className="text-sm text-white/70 leading-relaxed">{card.desc}</div>
                  </div>
                ))}
              </div>
              <p className="text-center text-xs text-white/70">
                {ZP_COSTS.footnote}
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 6: Implementation & Terminal */}
        <section className="bg-background py-10" data-testid="section-terminal-equipment">
          <div className="public-container">
            <div className="reveal max-w-5xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                <div className="flex flex-col gap-4 items-center order-2 md:order-1">
                  <img src={imgCloverFlex3} alt="Clover Flex 3 payment terminal" className="w-full max-w-xs rounded-md object-contain" data-testid="img-zero-terminal-hero" />
                  <img src={imgPaxA920} alt="PAX A920 smart payment terminal" className="w-full max-w-xs rounded-md object-cover" data-testid="img-zero-terminal-tap" />
                </div>
                <div className="order-1 md:order-2">
                  <h2 className="public-h2 font-display font-bold text-foreground mb-4" data-testid="text-terminal-heading">
                    {ZP_EQUIPMENT.heading}
                  </h2>
                  <p className="text-muted-foreground mb-6 leading-relaxed" data-testid="text-terminal-description">
                    {ZP_EQUIPMENT.description}
                  </p>
                  <ul className="space-y-3 mb-6">
                    {ZP_EQUIPMENT.steps.map((item, i) => (
                      <li key={i} className="flex items-start gap-3" data-testid={`impl-step-${i}`}>
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-primary-foreground text-xs font-bold">{i + 1}</span>
                        </div>
                        <span className="text-muted-foreground text-sm">{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button className="gap-2" asChild>
                      <Link href="/upload-statement" data-testid="link-zero-terminal-cta">
                        <Upload className="w-4 h-4" />
                        {ZP_EQUIPMENT.primaryCta}
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    </Button>
                    <Button variant="outline" className="gap-2" asChild>
                      <a href={PHONE_TEL} aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`} data-testid="link-zero-call-cta" onClick={() => trackPhoneCallClick({ sourcePage: ZP_PATH })}>
                        <Phone className="w-4 h-4" />
                        {ZP_EQUIPMENT.secondaryCta} {PHONE_NUMBER}
                      </a>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-4" data-testid="text-zero-equipment-footnote">{ZP_EQUIPMENT.footnote}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-muted py-10" data-testid="section-zero-faq">
          <div className="public-container">
            <div className="reveal max-w-3xl mx-auto">
              <h2
                className="public-h2 font-display font-bold text-foreground mb-8"
                data-testid="text-zero-faq-heading"
              >
                {ZP_FAQ_HEADING}
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
                <Button className="gap-2" asChild>
                  <Link href="/upload-statement" data-testid="link-faq-cta">
                    <Upload className="w-4 h-4" />
                    {ZP_HERO.cta}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden py-10" data-testid="section-zero-final-cta">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(221,83%,20%)] to-[hsl(222,47%,8%)]" />
          <div className="public-container relative text-center">
            <h2
              className="public-h2 font-display font-bold text-white mb-4"
              data-testid="text-zero-final-cta-heading"
            >
              {ZP_FINAL.heading}
            </h2>
            <p
              className="text-white/60 mb-8 max-w-2xl mx-auto"
              data-testid="text-zero-final-cta-body"
            >
              {ZP_FINAL.body}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Button size="lg" className="public-cta gap-2 bg-sky-400 border-sky-400 text-slate-950 hover:bg-sky-300" asChild>
                <Link href="/upload-statement" data-testid="link-zero-final-upload">
                  <Upload className="w-4 h-4" />
                  {ZP_FINAL.primaryCta}
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="public-cta gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white" asChild>
                <a href={PHONE_TEL} aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`} data-testid="link-zero-final-call" onClick={() => trackPhoneCallClick({ sourcePage: ZP_PATH })}>
                  <Phone className="w-4 h-4" />
                  Call {PHONE_NUMBER}
                </a>
              </Button>
            </div>
            <p className="text-xs text-white/70 mt-6 max-w-xl mx-auto">
              {ZP_FINAL.compliance}
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
