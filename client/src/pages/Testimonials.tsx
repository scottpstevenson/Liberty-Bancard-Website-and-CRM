import { useState } from "react";
import { SEO, type StructuredData } from "@/components/SEO";
import { LazyVideoEmbed } from "@/components/LazyVideoEmbed";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Quote,
  Star,
  ArrowRight,
  Upload,
  Video,
  UtensilsCrossed,
  Store,
  Stethoscope,
  Car,
  Wrench,
  ShoppingCart,
} from "lucide-react";

const BASE_URL = "https://libertybancard.com";

interface VideoTestimonial {
  id: string;
  merchantName: string;
  businessName: string;
  businessType: string;
  industry: string;
  cityState: string;
  headlineQuote: string;
  keyStat: string;
  keyStatLabel: string;
  youtubeId: string | null;
  thumbnailUrl: string;
  duration: string;
  isDemo: boolean;
}

const testimonials: VideoTestimonial[] = [
  {
    id: "maria-r-restaurant",
    merchantName: "Maria R.",
    businessName: "Full-Service Restaurant",
    businessType: "Full-Service Restaurant",
    industry: "Restaurant",
    cityState: "South Miami, FL",
    headlineQuote: "Our processing cost dropped to nearly zero after switching.",
    keyStat: "$4,200",
    keyStatLabel: "saved per year",
    // YouTube: placeholder embed — real merchant recording pending
    youtubeId: "M7lc1UVf-VE",
    thumbnailUrl: "",
    duration: "2:14",
    isDemo: true,
  },
  {
    id: "tony-m-auto",
    merchantName: "Tony M.",
    businessName: "Auto Repair Shop",
    businessType: "Independent Auto Repair Shop",
    industry: "Auto Repair",
    cityState: "Broward County, FL",
    headlineQuote: "They found $127 a month in fees I never agreed to.",
    keyStat: "$2,900",
    keyStatLabel: "saved per year",
    // YouTube: placeholder embed — real merchant recording pending
    youtubeId: "WHoFLGqBnGA",
    thumbnailUrl: "",
    duration: "1:58",
    isDemo: true,
  },
  {
    id: "david-k-retail",
    merchantName: "David K.",
    businessName: "Multi-Location Retail",
    businessType: "Retail Chain — 2 Locations",
    industry: "Retail",
    cityState: "Boca Raton, FL",
    headlineQuote: "The savings were immediate once we saw the real interchange cost.",
    keyStat: "$3,800",
    keyStatLabel: "saved per year",
    youtubeId: null,
    thumbnailUrl: "",
    duration: "2:31",
    isDemo: false,
  },
  {
    id: "dr-sarah-l-medical",
    merchantName: "Dr. Sarah L.",
    businessName: "Medical Practice",
    businessType: "Multi-Provider Medical Practice",
    industry: "Healthcare",
    cityState: "Tampa, FL",
    headlineQuote: "Level 2 processing alone saved us thousands on insurance card payments.",
    keyStat: "$6,100",
    keyStatLabel: "saved per year",
    youtubeId: null,
    thumbnailUrl: "",
    duration: "3:02",
    isDemo: false,
  },
  {
    id: "james-w-hvac",
    merchantName: "James W.",
    businessName: "HVAC Contractor",
    businessType: "Mobile HVAC Contractor",
    industry: "Home Services",
    cityState: "Palm Beach County, FL",
    headlineQuote: "Now I process everything through one system and my cost is basically zero.",
    keyStat: "$1,800",
    keyStatLabel: "saved per year",
    youtubeId: null,
    thumbnailUrl: "",
    duration: "1:45",
    isDemo: false,
  },
  {
    id: "rachel-t-ecommerce",
    merchantName: "Rachel T.",
    businessName: "Online Specialty Retailer",
    businessType: "Online Specialty Retailer",
    industry: "E-Commerce",
    cityState: "Remote / Online",
    headlineQuote: "We thought Shopify Payments was our only option — we were wrong.",
    keyStat: "$5,400",
    keyStatLabel: "saved per year",
    youtubeId: null,
    thumbnailUrl: "",
    duration: "2:48",
    isDemo: false,
  },
];

const INDUSTRIES = [
  "All",
  "Restaurant",
  "Retail",
  "Healthcare",
  "Auto Repair",
  "Home Services",
  "E-Commerce",
];

const INDUSTRY_ICONS: Record<string, typeof UtensilsCrossed> = {
  Restaurant: UtensilsCrossed,
  Retail: Store,
  Healthcare: Stethoscope,
  "Auto Repair": Car,
  "Home Services": Wrench,
  "E-Commerce": ShoppingCart,
};


const videoObjectSchema = (t: VideoTestimonial): StructuredData => ({
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: `${t.merchantName} — ${t.businessType} Testimonial | Liberty Bancard`,
  description: t.headlineQuote,
  thumbnailUrl: t.youtubeId
    ? `https://img.youtube.com/vi/${t.youtubeId}/maxresdefault.jpg`
    : (t.thumbnailUrl || `${BASE_URL}/favicon.png`),
  uploadDate: "2025-01-15",
  duration: `PT${t.duration.replace(":", "M")}S`,
  embedUrl: t.youtubeId ? `https://www.youtube.com/embed/${t.youtubeId}` : undefined,
  publisher: {
    "@type": "Organization",
    name: "Liberty Bancard",
    logo: { "@type": "ImageObject", url: `${BASE_URL}/favicon.png` },
  },
});

const reviewSchema = (t: VideoTestimonial): StructuredData => ({
  "@context": "https://schema.org",
  "@type": "Review",
  reviewBody: t.headlineQuote,
  author: {
    "@type": "Person",
    name: t.merchantName,
    jobTitle: t.businessType,
    address: { "@type": "PostalAddress", addressLocality: t.cityState },
  },
  itemReviewed: {
    "@type": "Organization",
    name: "Liberty Bancard",
    url: BASE_URL,
  },
  reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
});

export default function Testimonials() {
  const [selectedIndustry, setSelectedIndustry] = useState("All");

  const filtered =
    selectedIndustry === "All"
      ? testimonials
      : testimonials.filter((t) => t.industry === selectedIndustry);

  const schemas = [
    ...testimonials.map(videoObjectSchema),
    ...testimonials.map(reviewSchema),
  ];

  return (
    <>
      <SEO
        title="Merchant Video Testimonials — Real Results from Real Businesses | Liberty Bancard"
        description="Watch merchant testimonials from restaurant owners, retailers, healthcare practices, and more who saved thousands per year by switching to Liberty Bancard. Filter by industry."
        path="/testimonials"
        keywords="merchant testimonials, payment processing reviews, credit card processing success stories, Liberty Bancard reviews, merchant video testimonials"
        breadcrumbs={[{ name: "Testimonials", path: "/testimonials" }]}
        structuredData={schemas}
      />

      <Navbar />

      <main className="pt-32 pb-20">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-16">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <Badge variant="secondary" className="mb-4" data-testid="badge-testimonials">
              Merchant Stories
            </Badge>
            <h1
              className="text-4xl sm:text-5xl font-bold tracking-tight mb-6"
              data-testid="text-testimonials-title"
            >
              Real Merchants.{" "}
              <span className="text-primary">Real Numbers.</span>
            </h1>
            <p
              className="text-lg text-muted-foreground leading-relaxed mb-8"
              data-testid="text-testimonials-subtitle"
            >
              These are business owners who uploaded a statement and found out exactly what they were paying. Watch their stories — and see the before and after.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link href="/upload-statement" data-testid="link-testimonials-cta">
                <Button size="lg" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Get Your Free Analysis
                </Button>
              </Link>
              <Link href="/testimonials/submit" data-testid="link-testimonials-submit">
                <Button size="lg" variant="outline" className="gap-2">
                  <Video className="w-4 h-4" />
                  Share Your Story
                </Button>
              </Link>
            </div>
          </div>

          {/* Industry Filter */}
          <div
            className="flex flex-wrap gap-2 justify-center mb-12"
            data-testid="filter-industries"
          >
            {INDUSTRIES.map((industry) => (
              <button
                key={industry}
                onClick={() => setSelectedIndustry(industry)}
                className={`text-sm font-medium px-4 py-2 rounded-full border transition-colors ${
                  selectedIndustry === industry
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
                data-testid={`filter-${industry.toLowerCase().replace(/\s/g, "-").replace("/", "-")}`}
              >
                {industry}
              </button>
            ))}
          </div>

          {/* Testimonial Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filtered.map((t) => {
              const IndustryIcon = INDUSTRY_ICONS[t.industry] || Store;
              return (
                <Card
                  key={t.id}
                  className="overflow-hidden flex flex-col"
                  data-testid={`card-testimonial-${t.id}`}
                >
                  <div className="p-4 pb-0">
                    <LazyVideoEmbed
                      youtubeId={t.youtubeId}
                      thumbnailUrl={t.thumbnailUrl}
                      merchantName={t.merchantName}
                      duration={t.duration}
                      isDemo={t.isDemo}
                    />
                  </div>
                  <CardContent className="p-5 flex flex-col flex-grow">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <IndustryIcon className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <div
                            className="text-sm font-semibold text-foreground"
                            data-testid={`text-merchant-name-${t.id}`}
                          >
                            {t.merchantName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t.businessType}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className="text-lg font-bold text-emerald-600 dark:text-emerald-400"
                          data-testid={`text-key-stat-${t.id}`}
                        >
                          {t.keyStat}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          {t.keyStatLabel}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-0.5 mb-3">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      ))}
                    </div>

                    <div className="flex items-start gap-2 flex-grow">
                      <Quote className="w-4 h-4 text-primary/20 mt-0.5 shrink-0" />
                      <p
                        className="text-sm text-foreground leading-relaxed italic"
                        data-testid={`text-quote-${t.id}`}
                      >
                        {t.headlineQuote}
                      </p>
                    </div>

                    <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t.cityState}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {t.industry}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-16" data-testid="text-no-results">
              <p className="text-muted-foreground">No testimonials found for this filter.</p>
            </div>
          )}
        </section>

        {/* Video CTA Section */}
        <section className="bg-muted/30 py-16" data-testid="section-video-cta">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-2xl md:text-3xl font-bold mb-4"
              data-testid="text-video-cta-heading"
            >
              Want to Share Your Story?
            </h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              If you're a Liberty Bancard merchant with a success story to tell, we'd love to feature you. Submit your video or write a few lines — we handle the rest.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link href="/testimonials/submit" data-testid="link-cta-submit-story">
                <Button size="lg" className="gap-2">
                  <Video className="w-4 h-4" />
                  Submit Your Story
                </Button>
              </Link>
              <Link href="/case-studies" data-testid="link-cta-case-studies">
                <Button size="lg" variant="outline" className="gap-2">
                  Read Full Case Studies
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-20" data-testid="section-bottom-cta">
          <div className="bg-primary rounded-lg p-8 md:p-12 text-center text-primary-foreground">
            <h2
              className="text-2xl md:text-3xl font-bold mb-3"
              data-testid="text-bottom-cta-heading"
            >
              See What Your Statement Reveals
            </h2>
            <p className="text-primary-foreground/80 mb-6 max-w-xl mx-auto">
              Every merchant on this page started with a free statement review. Upload yours and we'll show you your real numbers — same day.
            </p>
            <Link href="/upload-statement" data-testid="link-bottom-cta">
              <Button
                size="lg"
                variant="secondary"
                className="gap-2"
              >
                <Upload className="w-4 h-4" />
                Get My Free Analysis
              </Button>
            </Link>
            <p className="text-xs text-primary-foreground/50 mt-4">
              Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without review.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
