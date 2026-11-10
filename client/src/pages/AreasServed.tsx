import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Upload, ArrowRight } from "lucide-react";
import { buildAreasServed } from "@shared/public-locations";

// The same content the server renders for the first HTML: South Florida first, then the rest of
// Florida, then the nationwide pages. A listed city is a page, not an office, a local team or a customer count.
const content = buildAreasServed();

const breadcrumbStructuredData = {
  "@context": "https://schema.org" as const,
  "@type": "BreadcrumbList" as const,
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
    { "@type": "ListItem", position: 2, name: "Areas Served", item: `https://libertybancard.com${content.path}` },
  ],
};

export default function AreasServed() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={content.title}
        description={content.metaDescription}
        path={content.path}
        structuredData={[breadcrumbStructuredData]}
      />
      <Navbar />

      <main className="flex-grow public-main-offset">
        <section className="relative overflow-hidden" data-testid="section-areas-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="public-container relative py-10 md:py-16">
            <Breadcrumbs items={[{ name: "Areas Served", path: content.path }]} variant="dark" className="mb-4" />
            <div className="flex items-center gap-2 text-sky-400 mb-4">
              <MapPin className="w-5 h-5" />
              <span className="text-sm font-medium" data-testid="text-areas-badge">{content.badge}</span>
            </div>
            <h1
              className="public-h1 public-h1--page font-display font-bold text-white mb-6 max-w-3xl"
              data-testid="text-areas-hero-title"
            >
              {content.h1}
            </h1>
            <p className="text-white/70 text-lg max-w-2xl mb-8 leading-relaxed" data-testid="text-areas-hero-subtitle">
              {content.lead}
            </p>
            <Button size="lg" className="public-cta gap-2 bg-sky-400 border-sky-400 text-slate-950 hover:bg-sky-300" asChild>
              <Link href={content.primaryAction.href} data-testid="link-areas-cta">
                <Upload className="w-4 h-4" />
                {content.primaryAction.label}
              </Link>
            </Button>
          </div>
        </section>

        <section className="py-10 bg-muted/30" data-testid="section-areas-grid">
          <div className="public-container">
            <h2 className="public-h2 font-display font-bold text-foreground text-center mb-4" data-testid="text-areas-grid-heading">
              {content.groupsHeading}
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto" data-testid="text-areas-coverage-note">
              {content.coverageNote}
            </p>

            {content.groups.map((group) => (
              <div key={group.region} className="mb-12 last:mb-0" data-testid={`group-areas-${group.region}`}>
                <h3 className="text-xl font-display font-bold text-foreground mb-2" data-testid={`text-areas-group-${group.region}`}>
                  {group.heading}
                </h3>
                <p className="text-sm text-muted-foreground mb-6">{group.intro}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" data-testid={`grid-cities-${group.region}`}>
                  {group.cities.map((city) => (
                    <Card key={city.slug} className="hover:shadow-md transition-shadow" data-testid={`card-city-${city.slug}`}>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg font-display">
                          <MapPin className="w-4 h-4 text-primary shrink-0" />
                          <Link href={city.hubHref} className="public-tap inline-flex items-center hover:text-primary transition-colors" data-testid={`link-city-${city.slug}`}>
                            {city.label}
                          </Link>
                        </CardTitle>
                      </CardHeader>
                      {city.verticals.length > 0 && (
                        <CardContent className="pt-0">
                          <ul className="space-y-2">
                            {city.verticals.map((vertical) => (
                              <li key={vertical.href}>
                                <Link
                                  href={vertical.href}
                                  className="public-tap flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors group"
                                  data-testid={`link-location-${city.slug}-${vertical.href.split("/")[3]}`}
                                >
                                  <ArrowRight className="w-3 h-3 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                                  {vertical.label}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="py-10" data-testid="section-areas-industries">
          <div className="public-container">
            <h2 className="public-h2 font-display font-bold text-foreground text-center mb-4" data-testid="text-areas-industries-heading">
              {content.industriesHeading}
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">{content.industriesIntro}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" data-testid="grid-industries">
              {content.industries.map((industry) => (
                <Card key={industry.label} className="text-center hover:shadow-md transition-shadow">
                  <CardContent className="py-6">
                    <Link
                      href={industry.href}
                      className="public-tap inline-flex items-center font-semibold text-foreground hover:text-primary transition-colors"
                      data-testid={`link-industry-${industry.href.split("/")[2]}`}
                    >
                      {industry.label}
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden py-10" data-testid="section-areas-cta">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="public-container relative text-center">
            <h2 className="public-h2 font-display font-bold text-white mb-4" data-testid="text-areas-cta-heading">
              {content.ctaHeading}
            </h2>
            <p className="text-white/70 mb-8 max-w-xl mx-auto" data-testid="text-areas-cta-body">
              {content.ctaBody}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" className="public-cta gap-2 bg-sky-400 border-sky-400 text-slate-950 hover:bg-sky-300" asChild>
                <Link href={content.primaryAction.href} data-testid="link-areas-cta-upload">
                  <Upload className="w-4 h-4" />
                  {content.primaryAction.label}
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="public-cta gap-2 bg-white/5 border-white/20 text-white" asChild>
                <Link href={content.secondaryAction.href} data-testid="link-areas-cta-contact">
                  {content.secondaryAction.label}
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
