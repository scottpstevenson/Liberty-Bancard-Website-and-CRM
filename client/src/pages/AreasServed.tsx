import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Upload, ArrowRight } from "lucide-react";
import { cities, topVerticals as verticals } from "@/pages/LocationIndustryPage";

const breadcrumbStructuredData = {
  "@context": "https://schema.org" as const,
  "@type": "BreadcrumbList" as const,
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
    { "@type": "ListItem", position: 2, name: "Areas We Serve", item: "https://libertybancard.com/areas-served" },
  ],
};

export default function AreasServed() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Payment Processing by City & Industry | Liberty Bancard"
        description="Liberty Bancard provides transparent interchange-plus payment processing across Florida and beyond. Browse all cities and industries we serve — restaurants, retail, healthcare, salons, and auto repair."
        path="/areas-served"
        structuredData={[breadcrumbStructuredData]}
      />
      <Navbar />

      <main className="flex-grow pt-28">
        <section className="relative overflow-hidden" data-testid="section-areas-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
            <Breadcrumbs
              items={[{ name: "Areas We Serve", path: "/areas-served" }]}
              variant="dark"
              className="mb-4"
            />
            <div className="flex items-center gap-2 text-sky-400 mb-4">
              <MapPin className="w-5 h-5" />
              <span className="text-sm font-medium" data-testid="text-areas-badge">Coverage Map</span>
            </div>
            <h1
              className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-white mb-6 max-w-3xl leading-tight"
              data-testid="text-areas-hero-title"
            >
              Payment Processing by City & Industry
            </h1>
            <p
              className="text-white/70 text-lg max-w-2xl mb-8 leading-relaxed"
              data-testid="text-areas-hero-subtitle"
            >
              Liberty Bancard serves businesses across the United States with transparent interchange-plus pricing and dedicated local support. Select your city and industry to see how much you can save.
            </p>
            <Link href="/upload-statement" data-testid="link-areas-cta">
              <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                <Upload className="w-4 h-4" />
                Get My Free Analysis
              </Button>
            </Link>
          </div>
        </section>

        <section className="py-16 bg-muted/30" data-testid="section-areas-grid">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4"
              data-testid="text-areas-grid-heading"
            >
              Cities We Serve
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
              Click any industry link below to see city-specific pricing data, local statistics, and a free savings estimate.
            </p>

            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
              data-testid="grid-cities"
            >
              {cities.map((city) => (
                <Card
                  key={city.slug}
                  className="hover:shadow-md transition-shadow"
                  data-testid={`card-city-${city.slug}`}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg font-display">
                      <MapPin className="w-4 h-4 text-primary shrink-0" />
                      {city.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="space-y-2">
                      {verticals.map((vertical) => (
                        <li key={vertical.slug}>
                          <Link
                            href={`/locations/${city.slug}/${vertical.slug}`}
                            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors group"
                            data-testid={`link-location-${city.slug}-${vertical.slug}`}
                          >
                            <ArrowRight className="w-3 h-3 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                            {vertical.name} Payment Processing
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16" data-testid="section-areas-industries">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4"
              data-testid="text-areas-industries-heading"
            >
              Industries We Specialize In
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
              We build pricing and support structures around each industry's specific needs — from tip optimization for restaurants to fleet card processing for auto shops.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" data-testid="grid-industries">
              {verticals.map((vertical) => (
                <Card
                  key={vertical.slug}
                  className="text-center hover:shadow-md transition-shadow"
                  data-testid={`card-industry-${vertical.slug}`}
                >
                  <CardContent className="py-6">
                    <p className="font-semibold text-foreground mb-3">{vertical.name}</p>
                    <div className="flex flex-col gap-1">
                      {cities.map((city) => (
                        <Link
                          key={city.slug}
                          href={`/locations/${city.slug}/${vertical.slug}`}
                          className="text-xs text-muted-foreground hover:text-primary transition-colors"
                          data-testid={`link-industry-${vertical.slug}-${city.slug}`}
                        >
                          {city.name}
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden py-20" data-testid="section-areas-cta">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-2xl md:text-3xl font-display font-bold text-white mb-4"
              data-testid="text-areas-cta-heading"
            >
              Don't See Your City?
            </h2>
            <p className="text-white/70 mb-8 max-w-xl mx-auto" data-testid="text-areas-cta-body">
              Liberty Bancard serves businesses throughout the United States. Upload your processing statement and we'll show you exactly how much you can save — regardless of your location.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/upload-statement" data-testid="link-areas-cta-upload">
                <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                  <Upload className="w-4 h-4" />
                  Upload Statement — Free Review
                </Button>
              </Link>
              <Link href="/about-contact" data-testid="link-areas-cta-contact">
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 border-white/20 text-white">
                  Contact Us
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
