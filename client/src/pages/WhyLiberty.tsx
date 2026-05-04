import { SEO, getLocalBusinessSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Upload,
  Calendar,
  CheckCircle2,
  Shield,
  Users,
  TrendingUp,
  Award,
  HeartHandshake,
  Lightbulb,
  Building2,
  Clock,
  DollarSign,
  Zap,
  Globe,
} from "lucide-react";
import heroTeam from "@assets/images/hero-team.jpg";
import teamCollab from "@assets/images/team-collab.png";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { CALENDAR_URL } from "@/lib/constants";
import { trackCalendarBooking } from "@/lib/tracking";

const stats = [
  { value: "10+", label: "Years in Payments", icon: Clock },
  { value: "5,000+", label: "Merchants Served", icon: Users },
  { value: "$2B+", label: "Annual Volume Processed", icon: DollarSign },
  { value: "99.9%", label: "Platform Uptime", icon: Zap },
];

const certifications = [
  {
    title: "PCI DSS Level 1 Certified",
    description: "We maintain the highest level of payment card industry data security compliance, protecting every transaction your business processes.",
    icon: Shield,
  },
  {
    title: "Registered ISO/MSP",
    description: "Liberty Bancard is a registered Independent Sales Organization with acquiring bank partnerships, ensuring institutional-grade processing infrastructure.",
    icon: Building2,
  },
  {
    title: "EMV & Contactless Ready",
    description: "All terminals and integrations support chip, tap, and mobile wallet payments including Apple Pay, Google Pay, and Samsung Pay.",
    icon: Globe,
  },
  {
    title: "PCI P2PE Validated",
    description: "Point-to-point encryption on supported terminals reduces your PCI scope and keeps cardholder data secure from swipe to settlement.",
    icon: Award,
  },
];

const values = [
  {
    title: "Transparency First",
    description: "We never hide fees. Every merchant gets a line-item statement review before we quote a rate. You see the math before you sign.",
    icon: Lightbulb,
  },
  {
    title: "Merchant-First Support",
    description: "Real humans answer the phone. No ticket queues, no chatbot runarounds. Your dedicated rep knows your business by name.",
    icon: HeartHandshake,
  },
  {
    title: "Technology Investment",
    description: "From AI-powered statement analysis to real-time reporting dashboards, we invest in tools that give you control over your processing costs.",
    icon: TrendingUp,
  },
];

const timeline = [
  {
    year: "2014",
    title: "Founded in Fort Lauderdale",
    description: "Liberty Bancard was founded with a simple mission: give business owners the same wholesale pricing that big-box retailers negotiate, without the complexity.",
  },
  {
    year: "2016",
    title: "1,000 Merchants Milestone",
    description: "Reached our first thousand active merchant accounts, serving restaurants, retail shops, and service businesses across Florida.",
  },
  {
    year: "2018",
    title: "Cash Discount Programs Launch",
    description: "Became one of the first ISOs to offer fully compliant cash discount programs, helping merchants legally eliminate up to 100% of processing fees.",
  },
  {
    year: "2020",
    title: "Technology Platform Built",
    description: "Launched our proprietary merchant portal with real-time analytics, automated statement reviews, and AI-driven cost optimization recommendations.",
  },
  {
    year: "2022",
    title: "National Expansion",
    description: "Expanded operations beyond Florida to serve merchants in all 50 states while maintaining the personalized, hands-on support that built our reputation.",
  },
  {
    year: "2024",
    title: "$2B+ Annual Processing Volume",
    description: "Surpassed $2 billion in annual processing volume. Launched next-generation AI statement analysis and automated merchant onboarding.",
  },
];

const teamExpertise = [
  "Former bank underwriters who know approval criteria inside and out",
  "Certified Payment Professionals (CPP) on staff",
  "Interchange optimization specialists with 15+ years of experience",
  "Dedicated compliance officers monitoring card brand rule changes",
  "In-house tech team building AI-powered cost analysis tools",
  "Bilingual support representatives (English & Spanish)",
];

const communityItems = [
  "Sponsor of local South Florida small business events and chambers of commerce",
  "Free educational workshops on payment processing for new business owners",
  "Partnerships with SCORE and SBA-affiliated mentorship programs",
  "Annual merchant appreciation events and networking opportunities",
  "Scholarship fund for aspiring entrepreneurs in underserved communities",
];

const BASE_URL = "https://libertybancard.com";

export default function WhyLiberty() {
  const containerRef = useScrollReveal();

  const aboutPageSchema = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "Why Liberty Bancard",
    description: "Learn why thousands of businesses trust Liberty Bancard for transparent, wholesale payment processing. PCI Level 1 certified, registered ISO, 10+ years of industry expertise.",
    url: `${BASE_URL}/why-liberty-bancard`,
    mainEntity: {
      "@type": "Organization",
      name: "Liberty Bancard",
      url: BASE_URL,
      logo: `${BASE_URL}/favicon.png`,
      foundingDate: "2014",
      foundingLocation: {
        "@type": "Place",
        name: "Fort Lauderdale, Florida",
      },
      description: "Liberty Bancard is a registered Independent Sales Organization providing transparent, statement-based payment processing for businesses nationwide. Wholesale interchange-plus pricing, compliant cash discount programs, next-day funding, and dedicated human support.",
      telephone: "+1-954-266-8214",
      email: "support@libertybancard.com",
      numberOfEmployees: {
        "@type": "QuantitativeValue",
        minValue: 25,
        maxValue: 50,
      },
      areaServed: {
        "@type": "Country",
        name: "United States",
      },
      hasCredential: [
        {
          "@type": "EducationalOccupationalCredential",
          credentialCategory: "certification",
          name: "PCI DSS Level 1 Service Provider",
        },
        {
          "@type": "EducationalOccupationalCredential",
          credentialCategory: "registration",
          name: "Registered ISO/MSP",
        },
      ],
      knowsAbout: [
        "Payment Processing",
        "Merchant Services",
        "Interchange Optimization",
        "Cash Discount Programs",
        "PCI Compliance",
        "Point of Sale Systems",
        "Credit Card Processing",
      ],
      slogan: "We prove your real cost and fix it.",
    },
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SEO
        title="Why Liberty Bancard — About Us, Mission & Certifications"
        description="Discover why 5,000+ merchants trust Liberty Bancard. PCI Level 1 certified, registered ISO, 10+ years in payments, $2B+ processed annually. Transparent pricing, real human support, and technology that saves you money."
        path="/why-liberty-bancard"
        keywords="Liberty Bancard reviews, best payment processor Florida, payment processing company near me, Liberty Bancard about us, merchant services Fort Lauderdale, transparent payment processing, PCI Level 1 payment processor"
        breadcrumbs={[{ name: "Why Liberty Bancard", path: "/why-liberty-bancard" }]}
        structuredData={[aboutPageSchema as any, getLocalBusinessSchema()]}
      />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>
        <section className="relative overflow-hidden" data-testid="section-why-hero">
          <div className="absolute inset-0">
            <img src={heroTeam} alt="Liberty Bancard professional payment processing team" className="w-full h-full object-cover" width="1408" height="792" />
            <div className="absolute inset-0 bg-gradient-to-r from-[hsl(222,47%,6%)/0.97] via-[hsl(222,47%,6%)/0.93] to-[hsl(222,47%,6%)/0.85]" />
          </div>
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="glow-blob glow-blob-2 w-48 h-48 bg-blue-600 bottom-10 left-1/4" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32">
            <div className="max-w-3xl reveal">
              <h1
                className="text-4xl md:text-5xl font-display font-bold text-white leading-tight mb-6"
                data-testid="text-why-heading"
              >
                Why <span className="text-sky-400">Liberty Bancard</span>?
              </h1>
              <p
                className="text-lg text-white/70 leading-relaxed mb-4"
                data-testid="text-why-subheading"
              >
                For over a decade, we've helped thousands of businesses stop overpaying for payment processing. We don't sell a rate — we prove your real cost and fix it.
              </p>
              <p className="text-base text-white/60 leading-relaxed mb-8">
                PCI Level 1 certified. Registered ISO. Serving restaurants, retail, healthcare, auto repair, and more across all 50 states with transparent, wholesale pricing and real human support.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link href="/upload-statement" data-testid="link-why-upload">
                  <Button className="gap-2 cta-pulse">
                    <Upload className="w-4 h-4" />
                    Free Statement Review
                  </Button>
                </Link>
                <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackCalendarBooking("why_liberty_hero")} data-testid="link-why-book-call">
                  <Button variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                    <Calendar className="w-4 h-4" />
                    Book a 10-Minute Call
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted bg-dots py-20" data-testid="section-stats">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.map((stat, i) => (
                <Card key={i} className={`reveal reveal-delay-${i + 1}`} data-testid={`card-stat-${i}`}>
                  <CardContent className="pt-6 pb-6 px-6 text-center">
                    <stat.icon className="w-8 h-8 text-sky-400 mx-auto mb-3" />
                    <p className="text-3xl md:text-4xl font-display font-bold text-foreground mb-1" data-testid={`text-stat-value-${i}`}>
                      {stat.value}
                    </p>
                    <p className="text-sm text-muted-foreground" data-testid={`text-stat-label-${i}`}>
                      {stat.label}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background bg-grid py-20" data-testid="section-story">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div className="reveal">
                <h2
                  className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
                  data-testid="text-story-heading"
                >
                  Our <span className="text-sky-400">Story</span>
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Liberty Bancard was founded in 2014 in Fort Lauderdale, Florida, by payment industry veterans who were frustrated by the lack of transparency in merchant services. Too many business owners were paying inflated rates, buried in hidden fees, and locked into contracts they didn't understand.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We started with a radical idea: show merchants their actual processing costs, line by line, before ever quoting a price. That statement-first approach became our foundation. Instead of a sales pitch, every new relationship begins with a free, no-obligation statement review where we break down exactly what you're paying and where you can save.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Today, Liberty Bancard serves over 5,000 merchants nationwide, processes more than $2 billion in annual card volume, and maintains a team of certified payment professionals dedicated to keeping your costs low and your business running smoothly.
                </p>
                <Link href="/upload-statement" data-testid="link-story-upload">
                  <Button className="gap-2">
                    <Upload className="w-4 h-4" />
                    Get Your Free Statement Review
                  </Button>
                </Link>
              </div>
              <div className="reveal reveal-delay-2">
                <img
                  src={teamCollab}
                  alt="Liberty Bancard team collaborating on merchant solutions"
                  className="rounded-md w-full"
                  loading="lazy"
                  width="1408"
                  height="792"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted bg-dots py-20" data-testid="section-timeline">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-12 text-center"
                data-testid="text-timeline-heading"
              >
                Our <span className="text-sky-400">Journey</span>
              </h2>
            </div>
            <div className="max-w-3xl mx-auto space-y-8">
              {timeline.map((item, i) => (
                <div key={i} className={`flex gap-6 reveal reveal-delay-${(i % 4) + 1}`} data-testid={`timeline-item-${i}`}>
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-12 h-12 rounded-md bg-primary flex items-center justify-center">
                      <span className="text-primary-foreground font-bold text-sm">{item.year}</span>
                    </div>
                    {i < timeline.length - 1 && (
                      <div className="w-0.5 flex-1 bg-border mt-2" />
                    )}
                  </div>
                  <div className="pb-8">
                    <h3 className="font-display font-bold text-foreground text-lg mb-2" data-testid={`text-timeline-title-${i}`}>
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background bg-grid py-20" data-testid="section-values">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4 text-center"
                data-testid="text-values-heading"
              >
                Our <span className="text-sky-400">Values</span>
              </h2>
              <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12">
                Every decision we make is guided by three core principles that put your business first.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {values.map((item, i) => (
                <Card key={i} className={`reveal reveal-delay-${i + 1}`} data-testid={`card-value-${i}`}>
                  <CardContent className="pt-8 pb-6 px-6">
                    <div className="w-14 h-14 rounded-md bg-primary/10 flex items-center justify-center mb-5">
                      <item.icon className="w-7 h-7 text-sky-400" />
                    </div>
                    <h3 className="font-display font-bold text-foreground text-lg mb-3" data-testid={`text-value-title-${i}`}>
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-muted bg-dots py-20" data-testid="section-certifications">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4 text-center"
                data-testid="text-certifications-heading"
              >
                Certifications & <span className="text-sky-400">Compliance</span>
              </h2>
              <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12">
                We hold the industry's highest security certifications so your business and your customers' data stay protected.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {certifications.map((cert, i) => (
                <Card key={i} className={`reveal reveal-delay-${i + 1}`} data-testid={`card-cert-${i}`}>
                  <CardContent className="pt-6 pb-6 px-6 flex gap-4">
                    <div className="w-12 h-12 rounded-md bg-primary flex items-center justify-center shrink-0">
                      <cert.icon className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-foreground text-base mb-2" data-testid={`text-cert-title-${i}`}>
                        {cert.title}
                      </h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {cert.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background bg-grid py-20" data-testid="section-team">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="reveal">
                <h2
                  className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
                  data-testid="text-team-heading"
                >
                  Team <span className="text-sky-400">Expertise</span>
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Our team brings decades of combined experience from both sides of the payments industry — processing, underwriting, compliance, and technology. When you work with Liberty Bancard, you're backed by professionals who understand your business.
                </p>
                <ul className="space-y-3">
                  {teamExpertise.map((item, i) => (
                    <li key={i} className="flex items-start gap-3" data-testid={`team-expertise-${i}`}>
                      <CheckCircle2 className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" />
                      <span className="text-muted-foreground text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="reveal reveal-delay-2">
                <h2
                  className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
                  data-testid="text-community-heading"
                >
                  Community <span className="text-sky-400">Involvement</span>
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  We believe in giving back to the business communities that trust us. From educational workshops to local sponsorships, Liberty Bancard is invested in helping entrepreneurs succeed beyond just payment processing.
                </p>
                <ul className="space-y-3">
                  {communityItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-3" data-testid={`community-item-${i}`}>
                      <CheckCircle2 className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" />
                      <span className="text-muted-foreground text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted bg-dots py-20" data-testid="section-pricing-philosophy">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto reveal">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6 text-center"
                data-testid="text-pricing-heading"
              >
                Our Pricing <span className="text-sky-400">Philosophy</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4 text-center">
                Most processors quote a rate and hope you never look at the fine print. We do the opposite.
              </p>
              <div className="space-y-4 mt-8">
                {[
                  "We review your current statement line by line — for free, with no obligation",
                  "We show you exactly what interchange rates you're paying and where markup is hiding",
                  "We recommend the best-fit program: wholesale interchange-plus, cash discount, or hybrid",
                  "We never pad interchange or add junk fees — what you see is what you pay",
                  "No long-term contracts required — we earn your business every month",
                  "If we can't save you money, we'll tell you — and explain why your current setup is already competitive",
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3" data-testid={`pricing-point-${i}`}>
                    <CheckCircle2 className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
              <div className="text-center mt-10">
                <Link href="/compare-rates" data-testid="link-compare-rates">
                  <Button variant="outline" className="gap-2">
                    Compare Our Rates
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden py-20" data-testid="section-cta">
          <div className="absolute inset-0">
            <img src={heroTeam} alt="Liberty Bancard team behind transparent payment processing" className="w-full h-full object-cover" loading="lazy" width="1408" height="792" />
            <div className="absolute inset-0 bg-gradient-to-r from-[hsl(222,47%,6%)/0.97] via-[hsl(222,47%,6%)/0.95] to-[hsl(222,47%,6%)/0.90]" />
          </div>
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="max-w-2xl mx-auto reveal">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-white mb-4"
                data-testid="text-cta-heading"
              >
                Ready to See What You're <span className="text-sky-400">Really Paying</span>?
              </h2>
              <p className="text-white/70 leading-relaxed mb-8">
                Upload your most recent processing statement and get a free, line-by-line cost analysis from our team. No obligation, no pressure — just the truth about your rates.
              </p>
              <div className="flex flex-wrap justify-center items-center gap-4">
                <Link href="/upload-statement" data-testid="link-cta-upload">
                  <Button className="gap-2 cta-pulse">
                    <Upload className="w-4 h-4" />
                    Upload Statement Now
                  </Button>
                </Link>
                <Link href="/savings-calculator" data-testid="link-cta-calculator">
                  <Button variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                    <TrendingUp className="w-4 h-4" />
                    Savings Calculator
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
