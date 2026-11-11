import { useState } from "react";
import { useParams } from "wouter";
import { SEO, getFAQSchema, getBreadcrumbSchema } from "@/components/SEO";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
import {
  Upload,
  ArrowRight,
  CheckCircle2,
  BarChart3,
  ShieldCheck,
  Headphones,
  DollarSign,
  Calculator,
  Users,
  Clock,
  Zap,
  Globe,
  CreditCard,
  BadgeCheck,
  Link2,
  Check,
  Calendar,
  Phone,
} from "lucide-react";
import { CALENDAR_URL, PHONE_TEL, PHONE_NUMBER } from "@/lib/constants";
import { trackBookingCtaClick, trackStatementUploadCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import {
  COMPARE_HERO_DISCLAIMER,
  COMPARE_NEEDS,
  COMPARE_TABLE_FOOTNOTE,
  getCompareEntry,
} from "@shared/compare-content";
import { describePriceRecord, formatCheckedDate } from "@shared/competitor-pricing";

const BASE_URL = "https://libertybancard.com";

export default function CompareVs() {
  const params = useParams<{ competitor: string }>();
  const containerRef = useScrollReveal();
  const data = getCompareEntry(params.competitor || "");

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
        <Navbar />
        <main className="flex-grow public-main-offset flex items-center justify-center">
          <div className="text-center px-4">
            <h1 className="text-3xl font-display font-bold text-foreground mb-4" data-testid="text-not-found">Comparison Not Found</h1>
            <p className="text-muted-foreground mb-6">We don't have a comparison page for that processor yet.</p>
            <Button asChild>
              <Link href="/compare-rates" data-testid="link-back-compare">View All Comparisons</Link>
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const faqSchema = getFAQSchema(data.faqs);
  const breadcrumbSchema = getBreadcrumbSchema([
    { name: "Compare", path: "/compare-rates" },
    { name: `vs ${data.name}`, path: `/compare/${data.slug}` },
  ]);

  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleShareCopy = async () => {
    const shareUrl = `${BASE_URL}/compare/${data.slug}?utm_source=agent&utm_medium=share&utm_content=compare-vs-${data.slug}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({ title: "Link copied!", description: "Ready to paste in email, text, or chat." });
      setTimeout(() => setCopied(false), 2200);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={data.metaTitle}
        brandSuffix={false}
        description={data.metaDescription}
        path={`/compare/${data.slug}`}
        keywords={data.metaKeywords}
        breadcrumbs={[
          { name: "Compare", path: "/compare-rates" },
          { name: `vs ${data.name}`, path: `/compare/${data.slug}` },
        ]}
        structuredData={[
          faqSchema,
          breadcrumbSchema,
        ]}
      />
      <Navbar />

      <main className="flex-grow public-main-offset" ref={containerRef}>
        <div className="public-container pt-4">
          <Breadcrumbs
            items={[
              { name: "Compare", path: "/compare-rates" },
              { name: `vs ${data.name}`, path: `/compare/${data.slug}` },
            ]}
          />
        </div>
        <section className="relative overflow-hidden" data-testid="section-vs-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="public-container relative py-10 lg:py-20">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white/90 text-sm font-medium px-3 py-1.5 rounded-md mb-6 border border-white/10" data-testid="text-vs-badge">
                <BarChart3 className="w-4 h-4" />
                Head-to-Head Comparison
              </div>
              <h1 className="public-h1 font-display font-bold text-white mb-4" data-testid="text-vs-heading">
                Liberty Bancard vs {data.name}
              </h1>
              <p className="text-base text-white/70 mb-2" data-testid="text-vs-tagline">
                {data.tagline}
              </p>
              <p className="text-sm text-white/60 mb-6 max-w-2xl mx-auto" data-testid="text-vs-description">
                {data.heroDescription}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
                <Button size="lg" className="public-cta gap-2 bg-white text-primary border-white" asChild>
                  <Link href={`/upload-statement?offer=beat-${data.slug}`} data-testid="link-vs-hero-upload" onClick={() => trackStatementUploadCtaClick({ page: `/compare/${data.slug}`, ctaLabel: "Upload Statement - Free Review", competitor: data.slug })}>
                    <Upload className="w-4 h-4" />
                    Upload Statement - Free Review
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="public-cta gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white" asChild>
                  <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="link-vs-hero-book" onClick={() => trackBookingCtaClick({ page: `/compare/${data.slug}`, ctaLabel: "Book a review call", ctaLocation: "hero", competitor: data.slug })}>
                    <Calendar className="w-4 h-4" />
                    Book a review call
                  </a>
                </Button>
                <Button size="lg" variant="ghost" className="public-cta gap-2 text-white/70 hover:text-white hover:bg-white/10 border border-white/20" asChild>
                  <a href={PHONE_TEL} aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`} data-testid="link-vs-hero-phone" onClick={() => trackPhoneCallClick({})}>
                    <Phone className="w-4 h-4" />
                    {PHONE_NUMBER}
                  </a>
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="gap-2 text-white/70 hover:text-white hover:bg-white/10 border border-white/20"
                  onClick={handleShareCopy}
                  data-testid="button-share-compare-vs"
                >
                  {copied ? <><Check className="w-4 h-4 text-green-400" /> Copied!</> : <><Link2 className="w-4 h-4" /> Share This Page</>}
                </Button>
              </div>
              <p className="text-xs text-white/70 mt-4 max-w-xl mx-auto">
                {COMPARE_HERO_DISCLAIMER}</p>
            </div>
          </div>
        </section>

        <div className="bg-muted/50 border-b border-border py-3" data-testid="section-trust-strip">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Free statement review</span>
              <span className="flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-sky-500" /> No obligation comparison</span>
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-primary" /> Transparent rate analysis</span>
              <span className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-primary" /> Line-item cost breakdown</span>
              <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-500" /> You keep the breakdown</span>
            </div>
          </div>
        </div>

        <section className="bg-background py-10" data-testid="section-vs-comparison-table">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-4" data-testid="text-vs-table-heading">
              Side-by-Side Comparison
            </h2>
            <p className="text-center text-muted-foreground mb-8 text-sm">
              {data.tableIntro}
            </p>
            <div className="reveal overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-[600px] border-collapse" data-testid="table-vs-comparison">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border w-44">Feature</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider p-3 border-b border-border">{data.name}</th>
                    <th className="text-center text-xs font-semibold text-primary uppercase tracking-wider p-3 border-b border-border bg-primary/5">Liberty Bancard</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-muted/20" : ""} data-testid={`row-vs-${i}`}>
                      <td className="text-sm font-medium text-foreground p-3 border-b border-border/50">{row.feature}</td>
                      <td className="text-center text-xs text-foreground p-3 border-b border-border/50">{row.provider}</td>
                      <td className="text-center text-xs text-foreground p-3 border-b border-border/50 bg-primary/5 font-medium">{row.liberty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-4">
              {COMPARE_TABLE_FOOTNOTE}
            </p>
          </div>
        </section>

        <section className="bg-muted/30 py-10" data-testid="section-vs-savings">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-8" data-testid="text-vs-savings-heading">
              {data.ratesHeading}
            </h2>
            <Card className="reveal" data-testid="card-savings-example">
              <CardContent className="p-6 md:p-8">
                {data.records.length > 0 ? (
                  <ul className="space-y-4" data-testid="list-price-records">
                    {data.records.map((record) => (
                      <li key={record.id} className="text-sm" data-testid={`price-record-${record.id}`}>
                        <p className="font-semibold text-foreground" data-testid={`price-record-text-${record.id}`}>
                          {describePriceRecord(record)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Source:{" "}
                          <a href={record.sourceUrl} className="underline" target="_blank" rel="noopener noreferrer">
                            {record.sourceUrl}
                          </a>
                          . Checked {formatCheckedDate(record.checkedOn)}.
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-published-rate">{data.unpublishedNote}</p>
                )}
                <div className="border-t border-border mt-6 pt-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{COMPARE_NEEDS.heading}</p>
                  <p className="text-sm text-muted-foreground mb-3">{COMPARE_NEEDS.intro}</p>
                  <ul className="space-y-2" data-testid="list-compare-needs">
                    {COMPARE_NEEDS.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
            <p className="text-[10px] text-muted-foreground text-center mt-4" data-testid="text-compare-method-note">
              {data.methodNote} {COMPARE_NEEDS.footnote}
            </p>
          </div>
        </section>

        <section className="bg-muted/30 py-10" data-testid="section-vs-who-should-use">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-8" data-testid="text-vs-who-heading">
              Who May Prefer Which
            </h2>
            <div className="reveal grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card data-testid="card-who-competitor">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                      <Globe className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <h3 className="font-display font-bold text-foreground">{data.name} May Suit You If...</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-who-competitor">{data.providerFit}</p>
                </CardContent>
              </Card>
              <Card data-testid="card-who-liberty">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                      <ShieldCheck className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-display font-bold text-foreground">Liberty Bancard May Suit You If...</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-who-liberty">{data.libertyFit}</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-vs-faq">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="public-h2 reveal font-display font-bold text-foreground text-center mb-8" data-testid="text-vs-faq-heading">
              {data.name} vs Liberty Bancard FAQ
            </h2>
            <Accordion type="single" collapsible className="reveal space-y-2" data-testid="accordion-vs-faq">
              {data.faqs.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border border-border rounded-md px-4">
                  <AccordionTrigger className="text-sm font-medium text-foreground text-left" data-testid={`vs-faq-trigger-${i}`}>
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground" data-testid={`vs-faq-content-${i}`}>
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="bg-primary text-primary-foreground py-10" data-testid="section-vs-final-cta">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="public-h2 font-display font-bold mb-4" data-testid="text-vs-cta-heading">
              Ready to Compare Your Costs With {data.name}?
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Upload your {data.name} processing statement for a free, line-by-line comparison. Keep the analysis even if you don't switch.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Button size="lg" className="public-cta gap-2 bg-white text-primary border-white" asChild>
                <Link href="/upload-statement" data-testid="link-vs-cta-upload">
                  <Upload className="w-4 h-4" />
                  Upload Statement - Free Review
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="public-cta gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white" asChild>
                <Link href="/compare-rates" data-testid="link-vs-cta-all">
                  <BarChart3 className="w-4 h-4" />
                  View All Comparisons
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
