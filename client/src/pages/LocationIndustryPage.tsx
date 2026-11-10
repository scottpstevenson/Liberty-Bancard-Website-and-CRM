import { SEO, getFAQSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LocationActions } from "@/components/public/LocationActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link, useParams } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, MapPin } from "lucide-react";
import { buildLocationDetail, locationDocumentTitle } from "@shared/public-locations";
import NotFound from "@/pages/not-found";

// One page for all 300 city and industry combinations. The words come from shared/public-locations.ts,
// the same module that builds the server document, so this page cannot add a local count, rate, office
// or promise that the first HTML does not carry. An unknown city or industry renders the 404 page.

export default function LocationIndustryPage() {
  const params = useParams<{ city: string; industry: string }>();
  const content = buildLocationDetail(params.city, params.industry);

  if (!content) return <NotFound />;

  const faqStructuredData = getFAQSchema(content.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })));

  const breadcrumbStructuredData = {
    "@context": "https://schema.org" as const,
    "@type": "BreadcrumbList" as const,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
      { "@type": "ListItem", position: 2, name: `${content.verticalName} Processing`, item: `https://libertybancard.com${content.industryHref}` },
      { "@type": "ListItem", position: 3, name: `${content.cityName}, ${content.state}`, item: `https://libertybancard.com${content.canonicalPath}` },
    ],
  };

  const serviceStructuredData = {
    "@context": "https://schema.org" as const,
    "@type": "Service" as const,
    name: content.title,
    description: content.metaDescription,
    url: `https://libertybancard.com${content.canonicalPath}`,
    serviceType: "Payment processing",
    provider: { "@type": "Organization", name: "Liberty Bancard", url: "https://libertybancard.com" },
    areaServed: {
      "@type": "City",
      name: content.cityName,
      containedInPlace: { "@type": "State", name: content.stateName },
    },
  };

  const trackPage = content.canonicalPath;

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={content.title}
        brandSuffix={locationDocumentTitle(content.title) !== content.title}
        description={content.metaDescription}
        path={content.canonicalPath}
        keywords={content.keywords}
        ogType="website"
        structuredData={[breadcrumbStructuredData, faqStructuredData, serviceStructuredData]}
      />
      <Navbar />

      <main className="marketing-surface flex-grow public-main-offset">
        <section className="marketing-surface relative overflow-hidden bg-background border-b border-border" data-testid="section-location-hero">
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
            <div className="accent-rule pt-5">
              <Breadcrumbs
                items={[
                  { name: `${content.verticalName} Processing`, path: content.industryHref },
                  { name: `${content.cityName}, ${content.state}`, path: content.hubHref },
                  { name: content.verticalName, path: content.canonicalPath },
                ]}
                className="mb-4"
              />
              <div className="flex items-center gap-2 text-accent mb-4">
                <MapPin className="w-5 h-5" />
                <span className="text-sm font-medium" data-testid="text-location-badge">{content.badge}</span>
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-foreground mb-6 max-w-3xl leading-tight" data-testid="text-location-hero-title">
                {content.h1}
              </h1>
              <p className="text-muted-foreground text-lg max-w-2xl mb-8 leading-relaxed" data-testid="text-location-hero-subtitle">
                {content.lead}
              </p>
              <LocationActions
                primary={content.primaryAction}
                secondary={content.secondaryAction}
                page={trackPage}
                city={content.citySlug}
                industry={content.verticalSlug}
                location="hero"
              />
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30" data-testid="section-location-benefits">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4" data-testid="text-workflow-heading">
              {content.workflowHeading}
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto" data-testid="text-location-workflow">
              {content.workflow}
            </p>
            <h3 className="text-xl font-display font-bold text-foreground text-center mb-6" data-testid="text-benefits-heading">
              {content.topicsHeading}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {content.topics.map((topic, i) => (
                <Card key={topic.title} data-testid={`card-benefit-${i}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                      <div>
                        <h4 className="font-semibold text-foreground mb-1">{topic.title}</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">{topic.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-center text-sm text-muted-foreground mt-10 max-w-2xl mx-auto" data-testid="text-location-coverage-note">
              {content.coverageNote}
            </p>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-location-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4" data-testid="text-faq-heading">
                {content.faqHeading}
              </h2>
              <Accordion type="single" collapsible className="space-y-2">
                {content.faqs.map((faq, i) => (
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

        <section className="relative overflow-hidden bg-primary text-primary-foreground py-20" data-testid="section-location-cta">
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold text-white mb-4" data-testid="text-cta-heading">
              {content.ctaHeading}
            </h2>
            <p className="text-white/70 mb-8 max-w-xl mx-auto" data-testid="text-cta-body">
              {content.ctaBody}
            </p>
            <div className="flex justify-center">
              <LocationActions
                primary={content.primaryAction}
                secondary={content.secondaryAction}
                page={trackPage}
                city={content.citySlug}
                industry={content.verticalSlug}
                location="final_cta"
                inverse
              />
            </div>
          </div>
        </section>

        <section className="bg-background py-12" data-testid="section-location-crosslinks">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h3 className="text-lg font-display font-bold text-foreground text-center mb-4" data-testid="text-crosslinks-heading">
              {content.citiesHeading}
            </h3>
            <div className="flex flex-wrap justify-center gap-3 mb-8">
              {content.relatedCities.map((link) => (
                <Button key={link.href} variant="outline" className="gap-2" asChild>
                  <Link href={link.href} data-testid={`link-city-${link.href.split("/")[2]}`}>
                    <MapPin className="w-4 h-4" />
                    {link.label}
                  </Link>
                </Button>
              ))}
            </div>
            <h3 className="text-lg font-display font-bold text-foreground text-center mb-4" data-testid="text-industries-heading">
              {content.verticalsHeading}
            </h3>
            <div className="flex flex-wrap justify-center gap-3">
              {content.relatedVerticals.map((link) => (
                <Button key={link.href} variant="outline" asChild>
                  <Link href={link.href} data-testid={`link-industry-${link.href.split("/")[3]}`}>{link.label}</Link>
                </Button>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
