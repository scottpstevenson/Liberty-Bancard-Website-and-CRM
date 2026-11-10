import { SEO } from "@/components/SEO";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link, useParams } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Upload,
  CheckCircle2,
  UtensilsCrossed,
  Store,
  Stethoscope,
  Scissors,
  Car,
  Briefcase,
  ShoppingCart,
  HardHat,
  HelpCircle,
  Phone,
  Smile,
  Sparkles,
  Scale,
  Calculator,
  Dumbbell,
  Hotel,
  MessageSquare,
} from "lucide-react";
import { PHONE_TEL, PHONE_NUMBER } from "@/lib/constants";
import { trackStatementUploadCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import { PublicImage } from "@/components/public/PublicImage";
import { PUBLIC_IMAGE_RECORDS, type PublicImageId } from "@/lib/public-imagery";
import {
  INDUSTRY_CONTENT,
  INDUSTRY_HERO_IMAGES,
  INDUSTRY_HERO_PICTURE,
  INDUSTRY_PRIMARY_ACTION,
  INDUSTRY_SECONDARY_ACTION,
  getIndustryContent,
  industrySections,
} from "@shared/public-industry-content";
import NotFound from "@/pages/not-found";

// The words on this page come from shared/public-industry-content.ts, the same module that builds the
// server document for each route. Only the icon is chosen here, by slug; the optional illustrative photo
// comes from INDUSTRY_HERO_IMAGES in the same shared module, so the server document shows the same picture.

interface IndustryPresentation {
  icon: typeof UtensilsCrossed;
}

const PRESENTATION: Record<string, IndustryPresentation> = {
  "restaurant-payment-processing": { icon: UtensilsCrossed },
  "retail-payment-processing": { icon: Store },
  "healthcare-payment-processing": { icon: Stethoscope },
  "salon-spa-payment-processing": { icon: Scissors },
  "auto-repair-payment-processing": { icon: Car },
  "professional-services-payment-processing": { icon: Briefcase },
  "ecommerce-payment-processing": { icon: ShoppingCart },
  "construction-payment-processing": { icon: HardHat },
  "dental-payment-processing": { icon: Smile },
  "med-spa-payment-processing": { icon: Sparkles },
  "legal-payment-processing": { icon: Scale },
  "accounting-payment-processing": { icon: Calculator },
  "fitness-payment-processing": { icon: Dumbbell },
  "hospitality-payment-processing": { icon: Hotel },
};

const FALLBACK_PRESENTATION: IndustryPresentation = { icon: Briefcase };

export default function IndustryPage() {
  const params = useParams<{ slug: string }>();
  const industry = getIndustryContent(params.slug);

  if (!industry) return <NotFound />;

  const { icon: Icon } = PRESENTATION[industry.slug] ?? FALLBACK_PRESENTATION;
  const heroImage = INDUSTRY_HERO_IMAGES[industry.slug];
  if (heroImage && !(heroImage in PUBLIC_IMAGE_RECORDS)) throw new Error(`Industry ${industry.slug} names unregistered image ${heroImage}`);
  const image = (heroImage as PublicImageId | undefined) ?? null;
  const sections = industrySections(industry);
  const pagePath = `/industries/${industry.slug}`;

  const breadcrumbStructuredData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
      { "@type": "ListItem", position: 2, name: "Industries", item: "https://libertybancard.com/industries" },
      { "@type": "ListItem", position: 3, name: industry.name, item: `https://libertybancard.com${pagePath}` },
    ],
  };

  const serviceStructuredData = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${industry.name} Payment Processing`,
    description: industry.metaDescription,
    url: `https://libertybancard.com${pagePath}`,
    serviceType: "Payment processing",
    provider: { "@type": "Organization", name: "Liberty Bancard", url: "https://libertybancard.com" },
  };

  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: industry.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  const track = (location: string) => () =>
    trackStatementUploadCtaClick({ page: pagePath, ctaLabel: INDUSTRY_PRIMARY_ACTION.label, ctaLocation: location, industry: industry.slug });

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={industry.metaTitle}
        description={industry.metaDescription}
        path={pagePath}
        keywords={industry.keywords}
        ogType="website"
        structuredData={[breadcrumbStructuredData, serviceStructuredData, faqStructuredData]}
      />
      <Navbar />

      <main className="marketing-surface flex-grow public-main-offset">
        <div className="public-container pt-4">
          <Breadcrumbs
            items={[
              { name: "Industries", path: "/industries" },
              { name: industry.name, path: pagePath },
            ]}
          />
        </div>
        <section className="marketing-surface relative overflow-hidden bg-background border-b border-border" data-testid="section-industry-hero">
          <div className="public-container relative py-10 lg:py-20">
            <div className={image ? "grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center lg:gap-14" : undefined}>
              <div className="accent-rule pt-5 max-w-3xl">
                <div className="inline-flex items-center gap-2 border border-border bg-card text-muted-foreground shadow-sm text-sm font-medium px-3 py-1.5 rounded-md mb-6" data-testid="text-industry-badge">
                  <Icon className="w-4 h-4" />
                  {industry.name} Payment Processing
                </div>
                <h1 className="public-h1 font-display font-bold text-foreground mb-6" data-testid="text-industry-heading">
                  {industry.heroTitle}
                </h1>
                <p className="text-lg text-muted-foreground mb-8 leading-relaxed max-w-2xl" data-testid="text-industry-subtitle">
                  {industry.heroSubtitle}
                </p>
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                  <Button size="lg" className="public-cta gap-2" asChild>
                    <Link href={INDUSTRY_PRIMARY_ACTION.href} data-testid="link-industry-hero-upload" onClick={track("hero")}>
                      <Upload className="w-4 h-4" />
                      {INDUSTRY_PRIMARY_ACTION.label}
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="public-cta gap-2" asChild>
                    <a href={INDUSTRY_SECONDARY_ACTION.href} data-testid="link-industry-hero-inquiry">
                      <MessageSquare className="w-4 h-4" />
                      {INDUSTRY_SECONDARY_ACTION.label}
                    </a>
                  </Button>
                  <Button size="lg" variant="ghost" className="public-cta gap-2" asChild>
                    <a href={PHONE_TEL} aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`} data-testid="link-industry-hero-phone" onClick={() => trackPhoneCallClick({})}>
                      <Phone className="w-4 h-4" />
                      {PHONE_NUMBER}
                    </a>
                  </Button>
                </div>
              </div>
              {image && (
                <div data-testid="industry-hero-visual">
                  <div className="public-frame public-frame--fill aspect-[16/10] lg:aspect-[4/3]">
                    <PublicImage id={image} variant={INDUSTRY_HERO_PICTURE.variant} sizes={INDUSTRY_HERO_PICTURE.sizes} priority data-testid="img-industry-hero" />
                  </div>
                  <p className="public-caption public-secondary mt-2">{INDUSTRY_HERO_PICTURE.caption}</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-10" data-testid="section-industry-pain-points">
          <div className="public-container">
            <h2 className="public-h2 font-display font-bold text-foreground text-center mb-4" data-testid="text-pain-heading">
              {sections.considerationsHeading}
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">{sections.considerationsIntro}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {industry.considerations.map((point, i) => (
                <Card key={point.title} data-testid={`card-pain-${i}`}>
                  <CardContent className="p-5 flex items-start gap-4">
                    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <HelpCircle className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">{point.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{point.description}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-industry-solutions">
          <div className="public-container">
            <h2 className="public-h2 font-display font-bold text-foreground text-center mb-4" data-testid="text-solutions-heading">
              {sections.reviewHeading}
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">{sections.reviewIntro}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {sections.review.map((item, i) => (
                <Card key={item.title} data-testid={`card-solution-${i}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                      <div>
                        <h3 className="font-semibold text-foreground mb-1">{item.title}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-10" data-testid="section-industry-faq">
          <div className="public-container">
            <div className="max-w-3xl mx-auto">
              <h2 className="public-h2 font-display font-bold text-foreground text-center mb-4" data-testid="text-faq-heading">
                {sections.faqHeading}
              </h2>
              <p className="text-center text-muted-foreground mb-10">{sections.faqIntro}</p>
              <Accordion type="single" collapsible className="space-y-2">
                {industry.faqs.map((faq, i) => (
                  <AccordionItem key={faq.question} value={`faq-${i}`} className="border rounded-md px-4" data-testid={`accordion-faq-${i}`}>
                    <AccordionTrigger className="text-left text-foreground font-medium py-4" data-testid={`trigger-faq-${i}`}>
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-4" data-testid={`content-faq-${i}`}>
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-primary text-primary-foreground py-10" data-testid="section-industry-cta">
          <div className="public-container relative text-center">
            <h2 className="public-h2 font-display font-bold text-white mb-4" data-testid="text-cta-heading">
              {sections.ctaHeading}
            </h2>
            <p className="text-white/70 mb-8 max-w-xl mx-auto" data-testid="text-cta-body">{sections.ctaBody}</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Button size="lg" className="public-cta gap-2 bg-accent hover:bg-accent border-accent text-white" asChild>
                <Link href={INDUSTRY_PRIMARY_ACTION.href} data-testid="link-cta-upload" onClick={track("final_cta")}>
                  <Upload className="w-4 h-4" />
                  {INDUSTRY_PRIMARY_ACTION.label}
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="public-cta gap-2 bg-transparent border-white/30 text-white hover:bg-white/10" asChild>
                <a href={INDUSTRY_SECONDARY_ACTION.href} data-testid="link-cta-inquiry">
                  <MessageSquare className="w-4 h-4" />
                  {INDUSTRY_SECONDARY_ACTION.label}
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-industry-crosslinks">
          <div className="public-container">
            <h3 className="text-lg font-display font-bold text-foreground text-center mb-6" data-testid="text-crosslinks-heading">
              {sections.crosslinksHeading}
            </h3>
            <div className="flex flex-wrap justify-center gap-3">
              {INDUSTRY_CONTENT.filter((entry) => entry.slug !== industry.slug).map((entry) => {
                const EntryIcon = (PRESENTATION[entry.slug] ?? FALLBACK_PRESENTATION).icon;
                return (
                  <Button key={entry.slug} variant="outline" className="gap-2" asChild>
                    <Link href={`/industries/${entry.slug}`} data-testid={`link-crosslink-${entry.slug}`}>
                      <EntryIcon className="w-4 h-4" />
                      {entry.name}
                    </Link>
                  </Button>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
