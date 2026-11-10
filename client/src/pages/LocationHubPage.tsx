import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LocationActions } from "@/components/public/LocationActions";
import { Card, CardContent } from "@/components/ui/card";
import { Link, useParams } from "wouter";
import { MapPin } from "lucide-react";
import { buildLocationHub, locationDocumentTitle } from "@shared/public-locations";
import NotFound from "@/pages/not-found";

// /locations/:city. The server has always answered this path; the client now owns the same route from
// the same shared content, so in-app navigation and a hard load show one page.
export default function LocationHubPage() {
  const params = useParams<{ city: string }>();
  const content = buildLocationHub(params.city);

  if (!content) return <NotFound />;

  const breadcrumbStructuredData = {
    "@context": "https://schema.org" as const,
    "@type": "BreadcrumbList" as const,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
      { "@type": "ListItem", position: 2, name: `${content.cityName}, ${content.state}`, item: `https://libertybancard.com${content.canonicalPath}` },
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

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={content.title}
        brandSuffix={locationDocumentTitle(content.title) !== content.title}
        description={content.metaDescription}
        path={content.canonicalPath}
        keywords={content.keywords}
        ogType="website"
        structuredData={[breadcrumbStructuredData, serviceStructuredData]}
      />
      <Navbar />

      <main className="marketing-surface flex-grow public-main-offset">
        <section className="marketing-surface relative overflow-hidden bg-background border-b border-border" data-testid="section-location-hero">
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
            <div className="accent-rule pt-5">
              <Breadcrumbs items={[{ name: `${content.cityName}, ${content.state}`, path: content.canonicalPath }]} className="mb-4" />
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
                page={content.canonicalPath}
                city={content.citySlug}
                location="hero"
              />
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30" data-testid="section-location-verticals">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4" data-testid="text-verticals-heading">
              {content.verticalsHeading}
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">{content.verticalsIntro}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {content.verticals.map((vertical) => (
                <Card key={vertical.slug} className="hover-elevate" data-testid={`card-vertical-${vertical.slug}`}>
                  <CardContent className="p-0">
                    <Link href={vertical.href} className="block p-5" data-testid={`link-vertical-${vertical.slug}`}>
                      <h3 className="font-semibold text-foreground mb-1">{vertical.name} Payment Processing</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-2">{vertical.summary}</p>
                      <span className="text-sm font-medium text-primary">{vertical.name} in {content.cityName}</span>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-center text-sm text-muted-foreground mt-10 max-w-2xl mx-auto" data-testid="text-location-coverage-note">
              {content.coverageNote}
            </p>
          </div>
        </section>

        <section className="relative overflow-hidden bg-primary text-primary-foreground py-20" data-testid="section-location-cta">
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold text-white mb-4" data-testid="text-cta-heading">
              {content.ctaHeading}
            </h2>
            <p className="text-white/70 mb-8 max-w-xl mx-auto" data-testid="text-cta-body">{content.ctaBody}</p>
            <div className="flex justify-center">
              <LocationActions
                primary={content.primaryAction}
                secondary={content.secondaryAction}
                page={content.canonicalPath}
                city={content.citySlug}
                location="final_cta"
                inverse
              />
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
