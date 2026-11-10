import { useState, useEffect, useMemo, useRef } from "react";
import { SEO, getServiceSchema } from "@/components/SEO";
import { trackSavingsCalculatorCompleted } from "@/lib/tracking";
import { serializeJsonLd } from "../../../shared/json-ld";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Upload,
  Calculator,
  ArrowRight,
  DollarSign,
  TrendingDown,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  CALC_COPY,
  CALC_PATH,
  CALC_STRUCTURED_DATA,
  EMPTY_CALC_INPUTS,
  calculateCosts,
  type CalcFieldId,
  type CalcInputs,
} from "@shared/public-cost-calculator";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

interface FieldSpec {
  id: CalcFieldId;
  label: string;
  hint: string;
  placeholder: string;
  prefix?: "$" | "%";
  step?: string;
}

const CURRENT_FIELDS: FieldSpec[] = [
  { id: "monthlyVolume", label: "Monthly card volume ($)", hint: "Total card sales per month, from your statement", placeholder: "e.g. 25000", prefix: "$" },
  { id: "avgTicket", label: "Average ticket ($)", hint: "Optional. Needed only to include a per-transaction fee", placeholder: "e.g. 45", prefix: "$" },
  { id: "currentRate", label: "Current effective rate (%)", hint: "Total monthly fees divided by monthly card volume", placeholder: "e.g. 3.2", prefix: "%", step: "0.01" },
];

const PROPOSED_FIELDS: FieldSpec[] = [
  { id: "proposedRate", label: "Percentage rate (%)", hint: "The rate on the quote. Enter 0 if it states none", placeholder: "e.g. 2.4", prefix: "%", step: "0.01" },
  { id: "proposedPerTransaction", label: "Per-transaction fee ($)", hint: "Per authorization or transaction. Enter 0 if none", placeholder: "e.g. 0.10", prefix: "$", step: "0.01" },
  { id: "proposedMonthlyFees", label: "Monthly and recurring fees ($)", hint: "Statement, gateway, PCI and similar fees. Enter 0 if none", placeholder: "e.g. 25", prefix: "$" },
  { id: "proposedEquipmentMonthly", label: "Equipment charges per month ($)", hint: "Lease or rental. Enter 0 if none", placeholder: "e.g. 0", prefix: "$" },
];

export default function SavingsCalculator() {
  const containerRef = useScrollReveal();
  const { toast } = useToast();

  const [inputs, setInputs] = useState<CalcInputs>(EMPTY_CALC_INPUTS);
  const [heroCopied, setHeroCopied] = useState(false);
  const calculatorFiredRef = useRef(false);

  const setField = (id: CalcFieldId, value: string) => setInputs((prev) => ({ ...prev, [id]: value }));
  const result = useMemo(() => calculateCosts(inputs), [inputs]);
  const errors = result.status === "invalid" ? result.errors : {};

  useEffect(() => {
    if (result.status === "ok" && result.monthlyDifferenceUsd !== null && !calculatorFiredRef.current) {
      calculatorFiredRef.current = true;
      // The event carries no amount, volume, rate or industry.
      trackSavingsCalculatorCompleted();
    }
  }, [result]);

  const handleHeroCopy = () => {
    const url = `https://libertybancard.com${CALC_PATH}?utm_source=agent&utm_medium=share&utm_content=savings-calculator`;
    navigator.clipboard.writeText(url).catch(() => {
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
    setHeroCopied(true);
    toast({ title: "Link copied!", description: "Ready to paste in email, text, or chat." });
    setTimeout(() => setHeroCopied(false), 2200);
  };

  const structuredData = { ...CALC_STRUCTURED_DATA, url: `https://libertybancard.com${CALC_PATH}` };

  const renderField = (spec: FieldSpec) => (
    <div className="space-y-2" key={spec.id}>
      <Label htmlFor={`calc-${spec.id}`}>{spec.label}</Label>
      <div className="relative">
        {spec.prefix === "$" && <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />}
        <Input
          id={`calc-${spec.id}`}
          type="number"
          inputMode="decimal"
          min="0"
          step={spec.step ?? "any"}
          placeholder={spec.placeholder}
          value={inputs[spec.id]}
          onChange={(e) => setField(spec.id, e.target.value)}
          className={`h-11 text-base ${spec.prefix === "$" ? "pl-9" : ""}`}
          aria-invalid={Boolean(errors[spec.id])}
          aria-describedby={`calc-${spec.id}-hint`}
          data-testid={`input-calc-${spec.id}`}
        />
      </div>
      <p id={`calc-${spec.id}-hint`} className={`text-xs ${errors[spec.id] ? "text-destructive" : "text-muted-foreground"}`} data-testid={`hint-calc-${spec.id}`}>
        {errors[spec.id] ?? spec.hint}
      </p>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={CALC_COPY.title}
        description={CALC_COPY.description}
        path={CALC_PATH}
        keywords={CALC_COPY.keywords}
        breadcrumbs={[{ name: CALC_COPY.breadcrumbLabel, path: CALC_PATH }]}
        structuredData={[getServiceSchema(CALC_COPY.title, CALC_COPY.description, CALC_PATH)]}
      />
      <Navbar />

      <main className="flex-grow public-main-offset" ref={containerRef}>
        <script type="application/ld+json">{serializeJsonLd(structuredData)}</script>

        <section className="relative overflow-hidden" data-testid="section-calc-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="public-container relative py-10 lg:py-20">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white/90 text-sm font-medium px-3 py-1.5 rounded-md mb-6 border border-white/10" data-testid="text-calc-badge">
                <Calculator className="w-4 h-4" />
                {CALC_COPY.badge}
              </div>
              <h1 className="public-h1 font-display font-bold text-white mb-4" data-testid="text-calc-heading">
                {CALC_COPY.h1}
              </h1>
              <p className="text-lg text-white/80 mb-2" data-testid="text-calc-subheading">
                {CALC_COPY.subtitle}
              </p>
              <p className="text-xs text-white/70 mb-5" data-testid="text-calc-disclaimer">
                {CALC_COPY.disclaimer}
              </p>
              <button
                onClick={handleHeroCopy}
                className="inline-flex items-center gap-2 text-white/80 hover:text-white text-sm border border-white/20 hover:border-white/40 rounded-md px-4 py-2.5 min-h-11 transition-colors"
                data-testid="button-share-calculator"
              >
                {heroCopied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    Link copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Share This Tool
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-calculator">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Card data-testid="card-calculator-input">
                <CardContent className="p-6 space-y-5">
                  <h2 className="text-xl font-display font-bold text-foreground" data-testid="text-calc-input-heading">
                    What you pay today
                  </h2>
                  {CURRENT_FIELDS.map(renderField)}

                  <h2 className="text-xl font-display font-bold text-foreground pt-2" data-testid="text-calc-proposed-heading">
                    The quote you hold
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Enter the pricing from a written quote. A total appears only when every field below is entered.
                  </p>
                  {PROPOSED_FIELDS.map(renderField)}

                  <div className="bg-muted/50 border border-border rounded-md p-3">
                    <p className="text-xs text-muted-foreground">
                      Don't know your effective rate? Upload your statement and we'll walk you through the fees on it.
                    </p>
                    <Button variant="outline" size="sm" className="mt-2 gap-1.5" asChild>
                      <Link href="/upload-statement">
                        <Upload className="w-3.5 h-3.5" />
                        Upload Statement
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-6" aria-live="polite">
                {result.status === "ok" ? (
                  <>
                    <Card className="border-2 border-primary/30" data-testid="card-results">
                      <CardContent className="p-6 space-y-5">
                        <h2 className="text-xl font-display font-bold text-foreground" data-testid="text-results-heading">
                          Your comparison
                        </h2>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-muted/50 rounded-md p-4" data-testid="result-current-fees">
                            <p className="text-xs text-muted-foreground mb-1">Current monthly cost</p>
                            <p className="text-2xl font-display font-bold text-foreground" data-testid="text-current-monthly">{usd(result.currentMonthlyUsd)}</p>
                            <p className="text-xs text-muted-foreground">from your entries</p>
                          </div>
                          <div className="bg-muted/50 rounded-md p-4" data-testid="result-proposed-fees">
                            <p className="text-xs text-muted-foreground mb-1">Quoted monthly cost</p>
                            {result.proposedMonthlyUsd !== null ? (
                              <>
                                <p className="text-2xl font-display font-bold text-foreground" data-testid="text-proposed-monthly">{usd(result.proposedMonthlyUsd)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {result.proposedEffectiveRatePct !== null ? `${result.proposedEffectiveRatePct}% of volume` : ""}
                                </p>
                              </>
                            ) : (
                              <p className="text-sm text-muted-foreground" data-testid="text-proposed-incomplete">
                                Not shown until every quote field is entered.
                              </p>
                            )}
                          </div>
                        </div>

                        <ul className="space-y-1.5 text-sm" data-testid="list-proposed-lines">
                          {result.proposedLines.map((line) => (
                            <li key={line.label} className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-muted-foreground">{line.label}</span>
                              <span className="font-medium text-foreground">
                                {line.monthlyUsd === null ? (line.note ?? "Not entered") : usd(line.monthlyUsd)}
                              </span>
                            </li>
                          ))}
                        </ul>

                        {result.monthlyDifferenceUsd !== null && result.annualDifferenceUsd !== null && result.direction ? (
                          <div className="bg-muted/50 border border-border rounded-md p-4 text-center" data-testid="result-difference-summary">
                            <p className="text-sm text-foreground font-medium mb-1" data-testid="text-difference-label">
                              {result.direction === "lower" && "The quote costs less each month"}
                              {result.direction === "higher" && "The quote costs more each month"}
                              {result.direction === "same" && "No difference each month"}
                            </p>
                            <p className="text-3xl font-display font-bold text-foreground" data-testid="text-monthly-difference">
                              {usd(Math.abs(result.monthlyDifferenceUsd))}
                            </p>
                            <p className="text-lg font-display font-semibold text-foreground/80 mt-1" data-testid="text-annual-difference">
                              {usd(Math.abs(result.annualDifferenceUsd))} per year
                            </p>
                            <p className="text-xs text-muted-foreground mt-2">
                              Annual figure is the monthly difference times 12, assuming the same volume and fees every month.
                            </p>
                            {result.transactionsPerMonth !== null && (
                              <p className="text-xs text-muted-foreground mt-1">
                                About {result.transactionsPerMonth.toLocaleString("en-US")} transactions per month at your average ticket.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="bg-muted/50 border border-border rounded-md p-4" data-testid="result-difference-withheld">
                            <p className="text-sm text-foreground font-medium mb-1">No difference is shown yet</p>
                            <p className="text-xs text-muted-foreground">
                              Still needed from the quote: {result.unknownLabels.join(", ")}.
                            </p>
                          </div>
                        )}

                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          {CALC_COPY.disclaimer}
                        </p>
                      </CardContent>
                    </Card>

                    <Button className="w-full gap-2" asChild>
                      <Link href="/upload-statement" data-testid="link-calc-upload">
                        <Upload className="w-4 h-4" />
                        Get a free statement review
                      </Link>
                    </Button>
                  </>
                ) : (
                  <Card data-testid="card-empty-state">
                    <CardContent className="p-8 text-center">
                      <Calculator className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-display font-bold text-foreground mb-2" data-testid="text-empty-heading">
                        {result.status === "invalid" ? "Check your entries" : "Enter your details"}
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4" data-testid="text-empty-message">
                        {result.status === "invalid"
                          ? "One or more entries cannot be used. The message under each field says what to change."
                          : `Enter ${result.missing.join(" and ").toLowerCase()} to see what you pay today, then the quote you hold to compare.`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Nothing is estimated for you. A blank field is treated as not entered, never as zero.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-10" data-testid="section-how-it-works">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-8" data-testid="text-how-heading">
              How it works
            </h2>
            <div className="reveal grid grid-cols-1 md:grid-cols-3 gap-6">
              {CALC_COPY.steps.map((step, i) => (
                <Card key={step.title} data-testid={`card-step-${i}`}>
                  <CardContent className="p-5">
                    <h3 className="font-display font-bold text-foreground mb-2">{i + 1}. {step.title}</h3>
                    <p className="text-sm text-muted-foreground">{step.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-why-rates-vary">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-4" data-testid="text-why-heading">
              {CALC_COPY.whyHeading}
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
              {CALC_COPY.whyIntro}
            </p>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {CALC_COPY.why.map((item, i) => (
                <Card key={item.title} data-testid={`card-why-${i}`}>
                  <CardContent className="p-5">
                    <h3 className="font-display font-bold text-foreground mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-10" data-testid="section-statement-review-adds">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-10" data-testid="text-how-saves-heading">
              {CALC_COPY.helpHeading}
            </h2>
            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              <div className="space-y-4">
                {CALC_COPY.help.map((item, i) => (
                  <div key={item.title} className="flex items-start gap-3" data-testid={`benefit-${i}`}>
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">{item.title}</span>
                      <p className="text-sm text-muted-foreground mt-0.5">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Card className="border-2 border-primary/20">
                <CardContent className="p-6 text-center">
                  <TrendingDown className="w-10 h-10 text-primary mx-auto mb-4" />
                  <h3 className="text-xl font-display font-bold text-foreground mb-2" data-testid="text-exact-cta-heading">
                    {CALC_COPY.exactHeading}
                  </h3>
                  <p className="text-muted-foreground text-sm mb-6">
                    {CALC_COPY.exactText}
                  </p>
                  <Button className="w-full gap-2" asChild>
                    <Link href="/upload-statement" data-testid="link-exact-upload">
                      <Upload className="w-4 h-4" />
                      {CALC_COPY.exactCta}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-calc-faq">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-8" data-testid="text-faq-heading">
              {CALC_COPY.faqHeading}
            </h2>
            <Accordion type="single" collapsible className="reveal space-y-2" data-testid="accordion-faq">
              {CALC_COPY.faq.map((item, i) => (
                <AccordionItem key={item.question} value={`faq-${i}`} className="border border-border rounded-md px-4">
                  <AccordionTrigger className="text-sm font-medium text-foreground text-left" data-testid={`faq-trigger-${i}`}>
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground" data-testid={`faq-content-${i}`}>
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="bg-primary text-primary-foreground py-10" data-testid="section-calc-final-cta">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="public-h2 font-display font-bold mb-4" data-testid="text-final-cta-heading">
              {CALC_COPY.finalHeading}
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              {CALC_COPY.finalText}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Button size="lg" className="public-cta gap-2 bg-white text-primary border-white" asChild>
                <Link href="/upload-statement" data-testid="link-final-upload">
                  <Upload className="w-4 h-4" />
                  Upload Statement - Free Review
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="public-cta gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white" asChild>
                <Link href="/compare-rates" data-testid="link-final-compare">
                  Compare Processors
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
