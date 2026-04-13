import { SEO, getFAQSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link, useParams } from "wouter";
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
  MapPin,
  Phone,
  FileText,
} from "lucide-react";

interface LocationIndustryData {
  citySlug: string;
  cityName: string;
  industrySlug: string;
  industryName: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string;
  heroTitle: string;
  heroSubtitle: string;
  localStats: { value: string; label: string }[];
  benefits: { title: string; description: string }[];
  faqs: { question: string; answer: string }[];
}

const cities = [
  { slug: "miami", name: "Miami" },
  { slug: "fort-lauderdale", name: "Fort Lauderdale" },
  { slug: "tampa", name: "Tampa" },
  { slug: "orlando", name: "Orlando" },
  { slug: "jacksonville", name: "Jacksonville" },
];

const topVerticals = [
  { slug: "restaurant", name: "Restaurant", industryPageSlug: "restaurant-payment-processing" },
  { slug: "auto-repair", name: "Auto Repair", industryPageSlug: "auto-repair-payment-processing" },
  { slug: "healthcare", name: "Healthcare", industryPageSlug: "healthcare-payment-processing" },
  { slug: "salon", name: "Salon & Spa", industryPageSlug: "salon-spa-payment-processing" },
  { slug: "retail", name: "Retail", industryPageSlug: "retail-payment-processing" },
];

function generateLocationData(city: typeof cities[0], vertical: typeof topVerticals[0]): LocationIndustryData {
  const cityPopData: Record<string, { businesses: string; metro: string }> = {
    miami: { businesses: "12,000+", metro: "6.1 million" },
    "fort-lauderdale": { businesses: "8,500+", metro: "1.9 million" },
    tampa: { businesses: "9,200+", metro: "3.2 million" },
    orlando: { businesses: "10,800+", metro: "2.7 million" },
    jacksonville: { businesses: "7,600+", metro: "1.6 million" },
  };

  const verticalData: Record<string, {
    benefits: { title: string; description: string }[];
    faqs: { question: string; answer: string }[];
    avgRate: string;
    avgSavings: string;
    localStat: string;
  }> = {
    restaurant: {
      avgRate: "2.4%",
      avgSavings: "$3,200",
      localStat: "Florida's restaurant industry generates over $67 billion in annual sales",
      benefits: [
        { title: "Interchange-plus pricing for restaurants", description: `${city.name} restaurants process high volumes of card transactions daily. Interchange-plus pricing reveals your true costs and saves on every swipe, dip, and tap.` },
        { title: "Next-day funding for FL restaurants", description: `Keep your cash flow moving with next-day deposits. Buy ingredients, pay staff, and manage daily operations without waiting days for your money.` },
        { title: "Tip adjustment optimization", description: `Tip adjustments inflate processing costs for restaurants. We configure your terminals to minimize the interchange impact of gratuity adjustments.` },
        { title: "Local support when you need it", description: `Based in Fort Lauderdale, our team understands the ${city.name} restaurant scene and provides responsive support during your busiest hours.` },
      ],
      faqs: [
        { question: `What is the best payment processor for restaurants in ${city.name}?`, answer: `The best processor for ${city.name} restaurants is one that offers interchange-plus pricing, understands tip adjustments, and provides next-day funding. Liberty Bancard specializes in restaurant payment processing with transparent pricing and local Florida support.` },
        { question: `How much can ${city.name} restaurants save on processing fees?`, answer: `We typically identify $3,200 or more in annual savings for restaurants in the ${city.name} area. Your actual savings depend on your volume, average ticket, and current pricing structure — which we'll identify in your free statement review.` },
        { question: "Do you serve restaurants throughout the metro area?", answer: `Yes. We serve restaurants across the greater ${city.name} metropolitan area, including all surrounding neighborhoods and suburbs.` },
        { question: "Can I keep my current POS system?", answer: "In most cases, yes. We integrate with major restaurant POS systems and aren't tied to any single platform. We'll confirm compatibility during your statement review." },
      ],
    },
    "auto-repair": {
      avgRate: "3.0%",
      avgSavings: "$4,800",
      localStat: "Florida has over 15,000 auto repair and service establishments",
      benefits: [
        { title: "High-ticket transaction optimization", description: `${city.name} auto shops process large repair invoices. Interchange-plus pricing saves significantly more on $1,000+ transactions than flat-rate pricing.` },
        { title: "Keyed-entry rate management", description: "Phone orders and fleet account payments get competitive keyed-entry rates, reducing the premium you pay on manually entered transactions." },
        { title: "Fast deposits for parts purchasing", description: `Auto shops need cash flow for parts. Qualified ${city.name} shops receive next-day deposits to keep your parts purchasing on schedule.` },
        { title: "Fleet and commercial card acceptance", description: "Accept Level II commercial and fleet cards at reduced interchange rates, saving your shop and fleet customers money." },
      ],
      faqs: [
        { question: `What is the cheapest credit card processing for auto shops in ${city.name}?`, answer: `The cheapest processing for ${city.name} auto shops is typically interchange-plus pricing, which saves the most on high-ticket transactions like engine work, transmission repairs, and body work. Upload your statement for a free comparison.` },
        { question: `How much can auto repair shops in ${city.name} save?`, answer: `We identify an average of $4,800 in annual savings for auto repair shops. Shops with higher average tickets or significant fleet card volume often save even more.` },
        { question: "Can I accept fleet cards at lower rates?", answer: "Yes. We configure your terminal for Level II processing, which qualifies fleet and commercial card transactions for lower interchange rates." },
        { question: "Will my large invoices be held?", answer: "We set appropriate processing limits during onboarding so legitimate large repair bills aren't flagged. This prevents unnecessary deposit delays." },
      ],
    },
    healthcare: {
      avgRate: "2.6%",
      avgSavings: "$4,100",
      localStat: "Florida's healthcare sector employs over 1.2 million workers",
      benefits: [
        { title: "Optimized pricing for patient payments", description: `${city.name} medical practices handle co-pays, procedure payments, and balances of varying sizes. Interchange-plus pricing optimizes costs across all transaction types.` },
        { title: "PCI-compliant payment solutions", description: "Secure, encrypted terminals and PCI-compliant processing infrastructure to protect patient payment data." },
        { title: "Patient payment plans", description: "Set up recurring billing for patient payment plans with secure card-on-file storage and automated charges." },
        { title: "Clear reporting for billing teams", description: `Help your ${city.name} practice billing team reconcile payments easily with detailed, exportable transaction reports.` },
      ],
      faqs: [
        { question: `What payment processing do ${city.name} medical practices use?`, answer: `${city.name} medical practices benefit from interchange-plus pricing with PCI-compliant terminals and detailed reporting. Liberty Bancard provides HIPAA-aware processing solutions designed for healthcare workflows.` },
        { question: "Is your processing HIPAA compliant?", answer: "Our payment processing is PCI DSS compliant. Payment data is handled separately from protected health information. We design solutions to support your overall compliance posture." },
        { question: "Can patients pay bills online?", answer: "Yes. We offer secure online payment links that patients can use to pay balances from any device, reducing collection calls." },
        { question: "Do you support recurring patient payment plans?", answer: "Yes. Secure card-on-file and recurring billing allow you to set up payment plans with automatic monthly charges." },
      ],
    },
    salon: {
      avgRate: "2.8%",
      avgSavings: "$2,400",
      localStat: "Florida's beauty and personal care industry serves millions of residents and tourists",
      benefits: [
        { title: "Tip-optimized processing", description: `${city.name} salons and spas process tips on nearly every transaction. We configure terminals to minimize the interchange cost of tip adjustments.` },
        { title: "Card-on-file for no-shows", description: "Protect your schedule with secure card-on-file storage for appointment deposits and no-show fee collection." },
        { title: "Software-agnostic integration", description: `Use your preferred salon management software without being locked into overpriced bundled processing rates.` },
        { title: "Next-day funding", description: `Qualified ${city.name} salons receive deposits by the next business day, keeping cash flow aligned with daily operations.` },
      ],
      faqs: [
        { question: `What is the best payment processing for salons in ${city.name}?`, answer: `The best processing for ${city.name} salons offers tip optimization, card-on-file for no-shows, and works with your existing scheduling software. Liberty Bancard provides all of these with transparent interchange-plus pricing.` },
        { question: "Can I charge no-show fees?", answer: "Yes. With secure card-on-file tokenization, you can store client cards and charge cancellation or no-show fees according to your salon's policy." },
        { question: "How do tip adjustments affect my costs?", answer: "Each tip adjustment can trigger higher interchange rates. We configure your terminal to prompt for tips at the point of sale, reducing post-authorization adjustments." },
        { question: "Do you work with salon booking software?", answer: "We work alongside your existing salon management software. Our processing integrates separately, so you're not locked into bundled rates." },
      ],
    },
    retail: {
      avgRate: "2.3%",
      avgSavings: "$2,800",
      localStat: "Florida retail sales exceed $300 billion annually",
      benefits: [
        { title: "True interchange-plus for retail", description: `${city.name} retailers save significantly on debit card transactions with interchange-plus pricing versus flat-rate processors.` },
        { title: "Terminal purchase options", description: "Own your equipment outright instead of paying inflated lease costs. Modern EMV and NFC terminals at competitive prices." },
        { title: "Multi-location management", description: `Manage multiple ${city.name} area locations with consolidated reporting and consistent pricing from a single point of contact.` },
        { title: "Chargeback support and prevention", description: "Guidance on chargeback responses and best practices to reduce disputes and protect your revenue." },
      ],
      faqs: [
        { question: `What is the cheapest credit card processing for retail in ${city.name}?`, answer: `For ${city.name} retail stores processing over $10,000/month, interchange-plus pricing consistently costs less than flat-rate processors like Square or Stripe. Upload your statement for a free comparison.` },
        { question: "Can I use my existing terminals?", answer: "Many existing terminals can be reprogrammed. We'll assess your equipment during onboarding and advise on compatibility." },
        { question: "Do you support contactless payments?", answer: "Yes. All terminals we provide support EMV chip, contactless/NFC, Apple Pay, and Google Pay." },
        { question: `Do you support multiple store locations in ${city.name}?`, answer: `Yes. We set up consolidated reporting across all your ${city.name} area locations with consistent pricing and one dedicated contact.` },
      ],
    },
  };

  const pop = cityPopData[city.slug] || { businesses: "5,000+", metro: "1 million" };
  const vd = verticalData[vertical.slug];

  return {
    citySlug: city.slug,
    cityName: city.name,
    industrySlug: vertical.slug,
    industryName: vertical.name,
    metaTitle: `${vertical.name} Payment Processing in ${city.name}, FL`,
    metaDescription: `Transparent payment processing for ${vertical.name.toLowerCase()} businesses in ${city.name}, Florida. Reduce credit card fees with interchange-plus pricing. Free statement review for ${city.name} ${vertical.name.toLowerCase()} owners.`,
    keywords: `${vertical.name.toLowerCase()} payment processing ${city.name}, ${city.name} ${vertical.name.toLowerCase()} credit card processing, ${vertical.name.toLowerCase()} merchant services ${city.name} FL, payment processing ${city.name} Florida`,
    heroTitle: `${vertical.name} Payment Processing in ${city.name}, FL`,
    heroSubtitle: `Serving ${pop.businesses} ${vertical.name.toLowerCase()} businesses in the greater ${city.name} metro area (population ${pop.metro}). Local support, transparent pricing, and real savings on every transaction.`,
    localStats: [
      { value: vd.avgRate, label: `Average effective rate on ${city.name} ${vertical.name.toLowerCase()} statements` },
      { value: vd.avgSavings, label: `Average annual savings identified per ${city.name} location` },
      { value: "FL-Based", label: "Local Fort Lauderdale headquarters with Florida support team" },
    ],
    benefits: vd.benefits,
    faqs: vd.faqs,
  };
}

const locationIndustryLookup: Record<string, LocationIndustryData> = {};
for (const city of cities) {
  for (const vertical of topVerticals) {
    const key = `${city.slug}/${vertical.slug}`;
    locationIndustryLookup[key] = generateLocationData(city, vertical);
  }
}

export const locationIndustryRoutes = Object.keys(locationIndustryLookup);

export const locationIndustryLinks = Object.entries(locationIndustryLookup).map(([key, data]) => ({
  city: data.cityName,
  industry: data.industryName,
  href: `/locations/${key}`,
}));

export default function LocationIndustryPage() {
  const params = useParams<{ city: string; industry: string }>();
  const key = `${params.city}/${params.industry}`;
  const data = locationIndustryLookup[key];

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <Navbar />
        <main className="flex-grow pt-20 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-4" data-testid="text-location-not-found">Page Not Found</h1>
            <Link href="/" data-testid="link-back-home">
              <Button>Back to Home</Button>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const vertical = topVerticals.find((v) => v.slug === data.industrySlug);

  const faqStructuredData = getFAQSchema(data.faqs);

  const breadcrumbStructuredData = {
    "@context": "https://schema.org" as const,
    "@type": "BreadcrumbList" as const,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
      { "@type": "ListItem", position: 2, name: `${data.industryName} Processing`, item: `https://libertybancard.com/industries/${vertical?.industryPageSlug || ""}` },
      { "@type": "ListItem", position: 3, name: `${data.cityName}, FL`, item: `https://libertybancard.com/locations/${key}` },
    ],
  };

  const localBusinessData = {
    "@context": "https://schema.org" as const,
    "@type": "LocalBusiness" as const,
    name: "Liberty Bancard",
    description: data.metaDescription,
    url: `https://libertybancard.com/locations/${key}`,
    telephone: "+1-954-266-8214",
    areaServed: {
      "@type": "City",
      name: data.cityName,
      containedInPlace: {
        "@type": "State",
        name: "Florida",
      },
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Fort Lauderdale",
      addressRegion: "FL",
      addressCountry: "US",
    },
  };

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title={data.metaTitle}
        description={data.metaDescription}
        path={`/locations/${key}`}
        keywords={data.keywords}
        ogType="website"
        structuredData={[breadcrumbStructuredData, faqStructuredData, localBusinessData]}
      />
      <Navbar />

      <main className="flex-grow pt-20">
        <section className="relative overflow-hidden" data-testid="section-location-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
            <div className="flex items-center gap-2 text-sky-400 mb-4">
              <MapPin className="w-5 h-5" />
              <span className="text-sm font-medium" data-testid="text-location-badge">{data.cityName}, Florida</span>
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-white mb-6 max-w-3xl leading-tight" data-testid="text-location-hero-title">
              {data.heroTitle}
            </h1>
            <p className="text-white/70 text-lg max-w-2xl mb-8 leading-relaxed" data-testid="text-location-hero-subtitle">
              {data.heroSubtitle}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/upload-statement" data-testid="link-location-upload">
                <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                  <Upload className="w-4 h-4" />
                  Free Statement Review
                </Button>
              </Link>
              <Link href={`/industries/${vertical?.industryPageSlug || ""}`} data-testid="link-location-industry">
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 border-white/20 text-white">
                  Learn More About {data.industryName} Processing
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30" data-testid="section-location-stats">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {data.localStats.map((stat, i) => (
                <Card key={i} data-testid={`card-stat-${i}`}>
                  <CardContent className="p-6 text-center">
                    <div className="text-3xl font-display font-bold text-primary mb-2">{stat.value}</div>
                    <div className="text-sm text-muted-foreground">{stat.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16" data-testid="section-location-benefits">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4" data-testid="text-benefits-heading">
              Why {data.cityName} {data.industryName} Businesses Choose Liberty Bancard
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
              We review your actual statement and build a solution around your real numbers — not estimates.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.benefits.map((benefit, i) => (
                <Card key={i} data-testid={`card-benefit-${i}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                      <div>
                        <h3 className="font-semibold text-foreground mb-1">{benefit.title}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">{benefit.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-location-faq">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground text-center mb-4" data-testid="text-faq-heading">
                {data.industryName} Payment Processing in {data.cityName}: FAQ
              </h2>
              <Accordion type="single" collapsible className="space-y-2">
                {data.faqs.map((faq, i) => (
                  <AccordionItem key={i} value={`faq-${i}`} className="border rounded-md px-4" data-testid={`accordion-faq-${i}`}>
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

        <section className="relative overflow-hidden py-20" data-testid="section-location-cta">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold text-white mb-4" data-testid="text-cta-heading">
              {data.cityName} {data.industryName} Owners: See What You're Really Paying
            </h2>
            <p className="text-white/70 mb-8 max-w-xl mx-auto" data-testid="text-cta-body">
              Upload your most recent processing statement. We'll break it down line-by-line and show you exactly where your money goes. Keep the analysis even if you don't switch.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-cta-upload">
                <Button size="lg" className="gap-2 bg-sky-500 border-sky-500 text-white">
                  <Upload className="w-4 h-4" />
                  Upload Statement — Free Review
                </Button>
              </Link>
              <a href="tel:+19542668214" data-testid="link-cta-call">
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 border-white/20 text-white">
                  <Phone className="w-4 h-4" />
                  Call (954) 266-8214
                </Button>
              </a>
            </div>
          </div>
        </section>

        <section className="bg-background py-12" data-testid="section-location-crosslinks">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h3 className="text-lg font-display font-bold text-foreground text-center mb-4" data-testid="text-crosslinks-heading">
              More {data.industryName} Processing Locations in Florida
            </h3>
            <div className="flex flex-wrap justify-center gap-3 mb-8">
              {cities
                .filter((c) => c.slug !== data.citySlug)
                .map((c) => (
                  <Link key={c.slug} href={`/locations/${c.slug}/${data.industrySlug}`} data-testid={`link-city-${c.slug}`}>
                    <Button variant="outline" className="gap-2">
                      <MapPin className="w-4 h-4" />
                      {c.name}
                    </Button>
                  </Link>
                ))}
            </div>
            <h3 className="text-lg font-display font-bold text-foreground text-center mb-4" data-testid="text-industries-heading">
              Other Industries in {data.cityName}
            </h3>
            <div className="flex flex-wrap justify-center gap-3">
              {topVerticals
                .filter((v) => v.slug !== data.industrySlug)
                .map((v) => (
                  <Link key={v.slug} href={`/locations/${data.citySlug}/${v.slug}`} data-testid={`link-industry-${v.slug}`}>
                    <Button variant="outline">{v.name}</Button>
                  </Link>
                ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
