
import { useState } from "react";
import { SEO } from "@/components/SEO";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { serializeJsonLd } from "../../../shared/json-ld";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
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
import { Upload, CheckCircle2, BarChart3, DollarSign, Calculator, BadgeCheck, Link2, Check } from "lucide-react";
import {
  COMPARE_METHOD_NOTE,
  COMPARE_NEEDS,
  COMPARE_SLUGS,
  COMPARE_ENTRIES,
  RATES_PAGE,
  ratesPageRows,
} from "@shared/compare-content";
import { formatCheckedDate } from "@shared/competitor-pricing";

const rateRows = ratesPageRows();

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": RATES_PAGE.schemaName,
  "url": "https://libertybancard.com/compare-rates",
  "description": RATES_PAGE.description,
};

export default function RateComparison() {
  const containerRef = useScrollReveal();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleShareCopy = async () => {
    const shareUrl = "https://libertybancard.com/compare-rates?utm_source=agent&utm_medium=share&utm_content=rate-comparison";
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    toast({ title: "Link copied!", description: "Ready to paste in email, text, or chat." });
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={RATES_PAGE.title}
        description={RATES_PAGE.description}
        path={RATES_PAGE.path}
        keywords={RATES_PAGE.keywords}
        breadcrumbs={[{ name: "Compare Rates", path: "/compare-rates" }]}
      />
      <Navbar />

      <main className="marketing-surface flex-grow public-main-offset" ref={containerRef}>
        <script type="application/ld+json">{serializeJsonLd(structuredData)}</script>
        <div className="public-container pt-2 pb-1">
          <Breadcrumbs items={[{ name: "Compare Rates", path: "/compare-rates" }]} />
        </div>

        <section className="marketing-surface relative overflow-hidden bg-background border-b border-border" data-testid="section-compare-hero">
          <div className="public-container relative py-10 lg:py-20">
            <div className="accent-rule pt-5 text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 border border-border bg-card text-muted-foreground shadow-sm text-sm font-medium px-3 py-1.5 rounded-md mb-6" data-testid="text-compare-badge">
                <BarChart3 className="w-4 h-4" />
                Published Rates, Dated and Sourced
              </div>
              <h1 className="public-h1 font-display font-bold text-foreground mb-4" data-testid="text-compare-heading">
                {RATES_PAGE.heading}
              </h1>
              <p className="text-lg text-muted-foreground mb-2" data-testid="text-compare-subheading">
                {RATES_PAGE.subheading}
              </p>
              <p className="text-xs text-muted-foreground mb-6" data-testid="text-compare-disclaimer">
                {RATES_PAGE.disclaimer}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={handleShareCopy}
                data-testid="button-share-compare-rates"
              >
                {copied ? <><Check className="w-4 h-4 text-emerald-700" /> Copied!</> : <><Link2 className="w-4 h-4" /> Share This Comparison</>}
              </Button>
            </div>
          </div>
        </section>

        <div className="bg-muted/50 border-b border-border py-3" data-testid="section-trust-strip">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-sky-500" /> Registered ISO/MSP</span>
            </div>
          </div>
        </div>

        <section className="bg-background py-10" data-testid="section-comparison-table">
          <div className="public-container">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-4" data-testid="text-features-heading">
              Published Provider Rates
            </h2>
            <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto text-sm">
              Each row is copied from the provider's official page and dated. {RATES_PAGE.libertyRowNote}
            </p>
            <div className="reveal hidden sm:block overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-[700px] border-collapse" data-testid="table-comparison">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Provider</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Product and plan</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Published rate</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Monthly fee</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Source and date</th>
                  </tr>
                </thead>
                <tbody>
                  {rateRows.map((row, i) => (
                    <tr key={`${row.slug}-${i}`} className={i % 2 === 0 ? "bg-muted/20" : ""} data-testid={`row-rate-${row.slug}-${i}`}>
                      <td className="text-sm font-medium text-foreground p-3 border-b border-border/50">
                        <Link href={`/compare/${row.slug}`} className="underline" data-testid={`link-rate-compare-${row.slug}-${i}`}>{row.provider}</Link>
                      </td>
                      <td className="text-xs text-muted-foreground p-3 border-b border-border/50">{row.detail}</td>
                      <td className="text-center text-sm text-foreground p-3 border-b border-border/50">{row.rate}</td>
                      <td className="text-center text-xs text-foreground p-3 border-b border-border/50">{row.monthly}</td>
                      <td className="text-xs text-muted-foreground p-3 border-b border-border/50">
                        {row.sourceUrl && row.checkedOn ? (
                          <>
                            <a href={row.sourceUrl} className="underline" target="_blank" rel="noopener noreferrer">Official page</a>
                            {" "}checked {formatCheckedDate(row.checkedOn)}
                          </>
                        ) : (
                          "No published rate to cite"
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-primary/5" data-testid="row-rate-liberty">
                    <td className="text-sm font-semibold text-primary p-3 border-b border-border/50">Liberty Bancard</td>
                    <td className="text-xs text-muted-foreground p-3 border-b border-border/50">Interchange-plus; programs reviewed where they fit</td>
                    <td className="text-center text-sm text-foreground p-3 border-b border-border/50">Quoted after statement review</td>
                    <td className="text-center text-xs text-foreground p-3 border-b border-border/50">Stated in your written quote</td>
                    <td className="text-xs text-muted-foreground p-3 border-b border-border/50">Written quote and agreement</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Mobile card view */}
            <div className="reveal sm:hidden space-y-3" data-testid="table-comparison-mobile">
              {rateRows.map((row, i) => (
                <Card key={`${row.slug}-m-${i}`} data-testid={`card-rate-${row.slug}-${i}`}>
                  <CardContent className="p-4">
                    <p className="font-semibold text-sm text-foreground mb-1">{row.provider}</p>
                    <p className="text-xs text-muted-foreground mb-3">{row.detail}</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Published rate</span>
                        <span className="text-sm text-foreground text-right">{row.rate}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Monthly fee</span>
                        <span className="text-xs text-foreground text-right">{row.monthly}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
                        <span className="text-xs text-muted-foreground">Source</span>
                        <span className="text-xs text-muted-foreground text-right">
                          {row.sourceUrl && row.checkedOn ? (
                            <>
                              <a href={row.sourceUrl} className="underline" target="_blank" rel="noopener noreferrer">Official page</a>
                              {", "}checked {formatCheckedDate(row.checkedOn)}
                            </>
                          ) : (
                            "No published rate to cite"
                          )}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Card className="border-primary/40 shadow-sm" data-testid="card-rate-liberty">
                <CardContent className="p-4">
                  <p className="font-semibold text-sm text-primary mb-1">Liberty Bancard</p>
                  <p className="text-xs text-muted-foreground">Quoted after statement review. The quote and agreement state every fee in writing.</p>
                </CardContent>
              </Card>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-4" data-testid="text-rates-method-note">
              {COMPARE_METHOD_NOTE}
            </p>
          </div>
        </section>

        <section className="bg-muted/30 py-10" data-testid="section-compare-needs">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-4" data-testid="text-needs-heading">
              {COMPARE_NEEDS.heading}
            </h2>
            <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto text-sm">{COMPARE_NEEDS.intro}</p>
            <Card className="reveal">
              <CardContent className="p-6">
                <ul className="space-y-2" data-testid="list-compare-needs">
                  {COMPARE_NEEDS.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <p className="text-[10px] text-muted-foreground text-center mt-4">{COMPARE_NEEDS.footnote}</p>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-compare-links">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-8" data-testid="text-compare-links-heading">
              Provider Comparisons
            </h2>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {COMPARE_SLUGS.map((slug) => (
                <Card key={slug} data-testid={`card-compare-link-${slug}`}>
                  <CardContent className="p-5">
                    <h3 className="font-display font-bold text-foreground mb-2">Liberty Bancard vs {COMPARE_ENTRIES[slug].name}</h3>
                    <p className="text-sm text-muted-foreground mb-3">{COMPARE_ENTRIES[slug].providerFit}</p>
                    <Link href={`/compare/${slug}`} className="text-sm font-medium text-primary underline" data-testid={`link-compare-${slug}`}>
                      View comparison
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-10" data-testid="section-why-liberty">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-10" data-testid="text-why-liberty-heading">
              How Liberty Bancard Quotes
            </h2>
            <div className="reveal grid grid-cols-1 sm:grid-cols-2 gap-6">
              {[
                { icon: DollarSign, title: "Interchange-Plus Pricing", desc: "The card network cost and Liberty Bancard's markup are shown as separate lines, so you can see what each part of your charges is." },
                { icon: BarChart3, title: "Statement-Based Analysis", desc: "We review your actual statement before recommending anything, and mark any fee we cannot identify as unknown." },
                { icon: Calculator, title: "Programs Reviewed Where They Fit*", desc: "Cash discount and surcharging are different programs. Whether either fits your business is confirmed in a business-specific review." },
                { icon: CheckCircle2, title: "Terms in Writing", desc: "Fees, equipment arrangements, term and cancellation are stated in your written quote and processing agreement before you decide." },
              ].map((item, i) => (
                <Card key={i} data-testid={`card-why-liberty-${i}`}>
                  <CardContent className="p-5">
                    <item.icon className="w-8 h-8 text-primary mb-3" />
                    <h3 className="font-display font-bold text-foreground mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-4">
              *Eligibility, underwriting, card brand rules, and applicable laws apply.
            </p>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-compare-faq">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-8" data-testid="text-compare-faq-heading">
              Frequently Asked Questions
            </h2>
            <Accordion type="single" collapsible className="reveal space-y-2" data-testid="accordion-compare-faq">
              {RATES_PAGE.faq.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border border-border rounded-md px-4">
                  <AccordionTrigger className="text-sm font-medium text-foreground text-left" data-testid={`compare-faq-trigger-${i}`}>
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground" data-testid={`compare-faq-content-${i}`}>
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="relative overflow-hidden bg-primary text-primary-foreground py-10" data-testid="section-compare-final-cta">
          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="public-h2 font-display font-bold mb-4" data-testid="text-compare-cta-heading">
              Ready to Compare Your Own Costs?
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Upload your processing statement for a free, line-by-line comparison. Keep the analysis even if you don't switch.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Button size="lg" className="public-cta gap-2 bg-accent hover:bg-accent border-accent text-white" asChild>
                <Link href="/upload-statement" data-testid="link-compare-cta-upload">
                  <Upload className="w-4 h-4" />
                  Upload Statement - Free Review
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="public-cta gap-2 bg-transparent border-white/30 text-white hover:bg-white/10" asChild>
                <Link href="/savings-calculator" data-testid="link-compare-cta-calc">
                  <Calculator className="w-4 h-4" />
                  Try the Calculator
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
