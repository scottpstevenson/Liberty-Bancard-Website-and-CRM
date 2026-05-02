import { useState } from "react";
import { SEO, type StructuredData } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Monitor,
  ShoppingCart,
  Calculator,
  Calendar,
  Users,
  Stethoscope,
  CheckCircle2,
  ArrowRight,
  Upload,
  ExternalLink,
  Puzzle,
} from "lucide-react";

interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  hardware: string;
  logoIcon: typeof Monitor;
  logoColor: string;
  learnMoreUrl?: string;
  badge?: string;
}

const integrations: Integration[] = [
  {
    id: "clover",
    name: "Clover POS",
    category: "POS Systems",
    description: "Liberty Bancard is a direct Clover provider. We program and support Clover terminals, mini systems, and the full Station Duo — with our own pricing, not Clover's published rates.",
    hardware: "Clover Flex 3, Clover Mini 3, Clover Station Duo",
    logoIcon: Monitor,
    logoColor: "text-green-600",
    badge: "Direct Provider",
  },
  {
    id: "dejavoo",
    name: "Dejavoo Terminals",
    category: "POS Systems",
    description: "Dejavoo countertop and wireless terminals work natively with Liberty's programs, including cash discount and tip adjust. Reliable, fast, and built for high-volume environments.",
    hardware: "Dejavoo QD2, QD4, Z11",
    logoIcon: Monitor,
    logoColor: "text-blue-600",
    badge: "Recommended",
  },
  {
    id: "pax",
    name: "PAX Terminals",
    category: "POS Systems",
    description: "PAX A920 and A35 smart terminals integrate cleanly with Liberty's interchange-plus pricing. Popular for retail and multi-lane environments.",
    hardware: "PAX A920, PAX A35",
    logoIcon: Monitor,
    logoColor: "text-gray-600",
  },
  {
    id: "toast",
    name: "Toast POS",
    category: "POS Systems",
    description: "Liberty Bancard integrates with Toast-compatible payment flows. Restaurants looking to lower their Toast processing costs can route through our interchange-plus gateway while keeping the Toast interface.",
    hardware: "Toast hardware (via gateway)",
    logoIcon: Monitor,
    logoColor: "text-red-600",
  },
  {
    id: "square",
    name: "Square (Migration)",
    category: "POS Systems",
    description: "Switching from Square? We handle the transition. Most Square merchants save significantly on interchange-plus pricing. Keep your Square hardware or upgrade to new — we'll map out both paths.",
    hardware: "Your existing Square hardware or new terminal",
    logoIcon: Monitor,
    logoColor: "text-sky-600",
    learnMoreUrl: "/beat-square-stripe",
    badge: "Switching Guide",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "Accounting",
    description: "Liberty Bancard transaction data exports cleanly into QuickBooks. Monthly statements include all the fields your bookkeeper or accountant needs for reconciliation.",
    hardware: "No hardware required",
    logoIcon: Calculator,
    logoColor: "text-green-700",
  },
  {
    id: "xero",
    name: "Xero",
    category: "Accounting",
    description: "Xero users can reconcile Liberty Bancard batch settlements easily. Our interchange-plus statements break down every cost line-by-line — no mystery totals.",
    hardware: "No hardware required",
    logoIcon: Calculator,
    logoColor: "text-blue-500",
  },
  {
    id: "wave",
    name: "Wave Accounting",
    category: "Accounting",
    description: "Wave-connected businesses can import Liberty Bancard transaction data and match settlements to deposits with clear reporting.",
    hardware: "No hardware required",
    logoIcon: Calculator,
    logoColor: "text-teal-600",
  },
  {
    id: "shopify",
    name: "Shopify / Shopify Payments",
    category: "eCommerce",
    description: "We integrate with Shopify via Authorize.net and NMI gateways, allowing merchants to bypass Shopify Payments fees while keeping their storefront untouched. Most Shopify merchants save $3,000–$6,000/year.",
    hardware: "Authorize.net or NMI gateway",
    logoIcon: ShoppingCart,
    logoColor: "text-green-600",
    learnMoreUrl: "/case-studies#ecommerce-flat-rate",
    badge: "Popular",
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    category: "eCommerce",
    description: "WooCommerce stores connect to Liberty Bancard through standard payment gateway plugins. Authorize.net and NMI are both supported with full WordPress plugin compatibility.",
    hardware: "Authorize.net or NMI gateway",
    logoIcon: ShoppingCart,
    logoColor: "text-purple-600",
  },
  {
    id: "bigcommerce",
    name: "BigCommerce",
    category: "eCommerce",
    description: "BigCommerce merchants can integrate Liberty Bancard's interchange-plus pricing through a compatible payment gateway, replacing flat-rate processors with cost-transparent pricing.",
    hardware: "NMI or Authorize.net gateway",
    logoIcon: ShoppingCart,
    logoColor: "text-blue-600",
  },
  {
    id: "authorize-net",
    name: "Authorize.net",
    category: "eCommerce",
    description: "Authorize.net is Liberty Bancard's primary e-commerce gateway. It supports recurring billing, customer vaults, and advanced fraud detection — all with our wholesale interchange-plus pricing underneath.",
    hardware: "Software gateway (no hardware)",
    logoIcon: ShoppingCart,
    logoColor: "text-orange-600",
    badge: "Primary Gateway",
  },
  {
    id: "mindbody",
    name: "Mindbody",
    category: "Practice Management",
    description: "Mindbody users in fitness, yoga, and wellness can connect Liberty Bancard's payment processing to reduce the per-transaction costs that accumulate at high-volume studios.",
    hardware: "Compatible card readers via gateway",
    logoIcon: Stethoscope,
    logoColor: "text-teal-600",
  },
  {
    id: "jane-app",
    name: "Jane App",
    category: "Practice Management",
    description: "Jane App is widely used by physical therapists, chiropractors, and allied health practices. Liberty Bancard can process payments outside Jane's native billing for lower interchange costs on high-value appointments.",
    hardware: "Dejavoo or PAX terminal",
    logoIcon: Stethoscope,
    logoColor: "text-blue-500",
  },
  {
    id: "drchrono",
    name: "DrChrono",
    category: "Practice Management",
    description: "Medical practices using DrChrono EHR can pair Liberty Bancard terminals for front-desk card collection, keeping their clinical workflow while reducing payment processing costs.",
    hardware: "Ingenico or Dejavoo countertop",
    logoIcon: Stethoscope,
    logoColor: "text-indigo-600",
  },
  {
    id: "acuity",
    name: "Acuity Scheduling",
    category: "Scheduling",
    description: "Acuity-based businesses — from photographers to consultants — can use Liberty Bancard's gateway integrations to collect payments at checkout or for deposits.",
    hardware: "Software gateway",
    logoIcon: Calendar,
    logoColor: "text-pink-600",
  },
  {
    id: "calendly",
    name: "Calendly",
    category: "Scheduling",
    description: "Service businesses using Calendly for bookings can combine Liberty Bancard's payment infrastructure for payment collection while keeping their scheduling workflow.",
    hardware: "Software gateway",
    logoIcon: Calendar,
    logoColor: "text-blue-600",
  },
  {
    id: "vagaro",
    name: "Vagaro",
    category: "Scheduling",
    description: "Salons, spas, and fitness studios on Vagaro can explore Liberty Bancard's payment processing as a lower-cost alternative to Vagaro's native payment rates.",
    hardware: "Compatible card readers",
    logoIcon: Calendar,
    logoColor: "text-purple-600",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "CRM",
    description: "Enterprise merchants using Salesforce CRM can integrate Liberty Bancard transaction data into their customer records via standard API exports and Zapier-based automation.",
    hardware: "No hardware required",
    logoIcon: Users,
    logoColor: "text-blue-700",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "CRM",
    description: "Liberty Bancard's back-office data can connect to HubSpot for deal tracking, renewal management, and merchant lifecycle automation.",
    hardware: "No hardware required",
    logoIcon: Users,
    logoColor: "text-orange-600",
  },
  {
    id: "zoho",
    name: "Zoho CRM",
    category: "CRM",
    description: "Zoho CRM users can sync Liberty Bancard merchant data and transaction summaries through standard integrations for account management and reporting.",
    hardware: "No hardware required",
    logoIcon: Users,
    logoColor: "text-red-500",
  },
];

const CATEGORIES = [
  { name: "POS Systems", icon: Monitor, description: "Terminals, registers, and point-of-sale systems" },
  { name: "Accounting", icon: Calculator, description: "Bookkeeping and financial reporting software" },
  { name: "eCommerce", icon: ShoppingCart, description: "Online stores and payment gateways" },
  { name: "Practice Management", icon: Stethoscope, description: "Healthcare and professional services platforms" },
  { name: "Scheduling", icon: Calendar, description: "Appointment and booking management tools" },
  { name: "CRM", icon: Users, description: "Customer relationship management platforms" },
];

const integrationsSchema: StructuredData = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Software Integrations & Compatibility | Liberty Bancard",
  description:
    "See which POS systems, accounting software, eCommerce platforms, and business tools Liberty Bancard works with. We integrate with your existing software — no lock-in.",
  url: "https://libertybancard.com/integrations",
  about: {
    "@type": "Service",
    name: "Payment Processing Integrations",
    provider: { "@type": "Organization", name: "Liberty Bancard" },
    description: "Payment processing that connects with your existing business software",
  },
};

export default function Integrations() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filtered = selectedCategory
    ? integrations.filter((i) => i.category === selectedCategory)
    : integrations;

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    items: filtered.filter((i) => i.category === cat.name),
  })).filter((cat) => cat.items.length > 0);

  return (
    <>
      <SEO
        title="Software Integrations & Compatibility — Works With Your Existing Tools | Liberty Bancard"
        description="Liberty Bancard works with Clover, Toast, QuickBooks, Shopify, Mindbody, Acuity, and 20+ more platforms. Keep your software, lower your processing costs."
        path="/integrations"
        keywords="payment processing integrations, POS integrations, QuickBooks payment processing, Shopify payment processor, Clover payment processing, merchant software compatibility"
        breadcrumbs={[{ name: "Integrations", path: "/integrations" }]}
        structuredData={[integrationsSchema]}
      />

      <Navbar />

      <main className="pt-32 pb-20">
        {/* Hero */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-16">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <Badge variant="secondary" className="mb-4" data-testid="badge-integrations">
              Software Compatibility
            </Badge>
            <h1
              className="text-4xl sm:text-5xl font-bold tracking-tight mb-6"
              data-testid="text-integrations-title"
            >
              Works With{" "}
              <span className="text-primary">Your Existing Software</span>
            </h1>
            <p
              className="text-lg text-muted-foreground leading-relaxed mb-8"
              data-testid="text-integrations-subtitle"
            >
              Unlike Square, Clover, and Toast — which lock you into their ecosystem — Liberty Bancard connects with the platforms you already use. Keep your POS, your accounting software, your booking tool. Just pay less.
            </p>

            {/* Anti-lock-in callout */}
            <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg p-5 mb-8 text-left max-w-2xl mx-auto">
              <div className="flex items-start gap-3">
                <Puzzle className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-1">
                    No Ecosystem Lock-In
                  </p>
                  <p className="text-sm text-sky-800/80 dark:text-sky-200/80">
                    Square, Clover, and Toast want you dependent on their payment rails. Liberty Bancard does the opposite — we plug into your workflow, not the other way around. Switch processors without switching software.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 justify-center">
              <Link href="/upload-statement" data-testid="link-integrations-cta">
                <Button size="lg" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Get My Free Analysis
                </Button>
              </Link>
              <a
                href="#category-list"
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors"
                data-testid="link-browse-integrations"
              >
                Browse Integrations
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto mb-16">
            {[
              { stat: "20+", label: "Compatible Platforms" },
              { stat: "6", label: "Integration Categories" },
              { stat: "0", label: "Lock-In Contracts" },
              { stat: "Free", label: "Compatibility Check" },
            ].map((item, i) => (
              <div
                key={i}
                className="text-center bg-muted/30 rounded-lg p-4"
                data-testid={`stat-integrations-${i}`}
              >
                <div className="text-2xl font-bold text-primary mb-1">{item.stat}</div>
                <div className="text-xs text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>

          {/* Category Filter */}
          <div
            id="category-list"
            className="flex flex-wrap gap-2 justify-center mb-12"
            data-testid="filter-categories"
          >
            <button
              onClick={() => setSelectedCategory(null)}
              className={`text-sm font-medium px-4 py-2 rounded-full border transition-colors ${
                selectedCategory === null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              }`}
              data-testid="filter-all"
            >
              All Categories
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.name}
                onClick={() => setSelectedCategory(cat.name)}
                className={`text-sm font-medium px-4 py-2 rounded-full border transition-colors ${
                  selectedCategory === cat.name
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
                data-testid={`filter-${cat.name.toLowerCase().replace(/\s/g, "-")}`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Integration Tiles by Category */}
          <div className="space-y-14">
            {grouped.map((cat) => (
              <div key={cat.name} data-testid={`section-category-${cat.name.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <cat.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{cat.name}</h2>
                    <p className="text-sm text-muted-foreground">{cat.description}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {cat.items.map((integration) => (
                    <Card
                      key={integration.id}
                      className="flex flex-col hover:shadow-md transition-shadow"
                      data-testid={`card-integration-${integration.id}`}
                    >
                      <CardContent className="p-5 flex flex-col flex-grow">
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                              <integration.logoIcon
                                className={`w-5 h-5 ${integration.logoColor}`}
                              />
                            </div>
                            <div>
                              <h3
                                className="text-sm font-semibold text-foreground"
                                data-testid={`text-integration-name-${integration.id}`}
                              >
                                {integration.name}
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                {integration.category}
                              </p>
                            </div>
                          </div>
                          {integration.badge && (
                            <Badge variant="secondary" className="text-xs shrink-0">
                              {integration.badge}
                            </Badge>
                          )}
                        </div>

                        <p
                          className="text-sm text-muted-foreground leading-relaxed mb-4 flex-grow"
                          data-testid={`text-integration-desc-${integration.id}`}
                        >
                          {integration.description}
                        </p>

                        <div className="border-t border-border pt-3">
                          <div className="flex items-start gap-2 mb-3">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                            <p
                              className="text-xs text-muted-foreground"
                              data-testid={`text-integration-hardware-${integration.id}`}
                            >
                              <span className="font-medium text-foreground">Compatible hardware: </span>
                              {integration.hardware}
                            </p>
                          </div>

                          {integration.learnMoreUrl && (
                            <Link
                              href={integration.learnMoreUrl}
                              className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
                              data-testid={`link-integration-learn-${integration.id}`}
                            >
                              Learn more
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Don't see your software? */}
        <section className="bg-muted/30 py-16" data-testid="section-not-listed">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2
              className="text-2xl md:text-3xl font-bold mb-4"
              data-testid="text-not-listed-heading"
            >
              Don't See Your Software?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
              We integrate with dozens of platforms beyond this list. If you use a specific POS, EHR, booking tool, or accounting system, ask us about compatibility during your free statement review.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link href="/upload-statement" data-testid="link-not-listed-cta">
                <Button size="lg" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Get My Free Analysis
                </Button>
              </Link>
              <a
                href="mailto:support@libertybancard.com"
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors"
                data-testid="link-email-integrations"
              >
                Ask About Compatibility
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>

        {/* Why Liberty vs Square / Clover */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-20" data-testid="section-vs-lockin">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="border-2 border-red-200 dark:border-red-900" data-testid="card-lockin-comparison">
              <CardContent className="p-6">
                <h3 className="text-lg font-bold mb-4 text-foreground">
                  Square / Clover / Toast Lock You In
                </h3>
                <ul className="space-y-3">
                  {[
                    "Must use their payment processor — no choice",
                    "Hardware only works on their network",
                    "Rate changes are buried in the terms",
                    "Switching means replacing all your hardware",
                    "Their ecosystem, their markup — forever",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-red-500 font-bold shrink-0">✕</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="border-2 border-emerald-200 dark:border-emerald-800" data-testid="card-liberty-comparison">
              <CardContent className="p-6">
                <h3 className="text-lg font-bold mb-4 text-foreground">
                  Liberty Bancard Connects With What You Have
                </h3>
                <ul className="space-y-3">
                  {[
                    "Works with Clover, Toast, PAX, Dejavoo, and more",
                    "Keep your POS or upgrade on your terms",
                    "Transparent interchange-plus pricing always",
                    "Switch without replacing existing software",
                    "We earn your business every month — no lock-in",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <div className="text-center mt-10">
            <Link href="/upload-statement" data-testid="link-vs-cta">
              <Button size="lg" className="gap-2">
                <Upload className="w-4 h-4" />
                Get My Free Analysis
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <p className="text-xs text-muted-foreground mt-3">
              Eligibility, underwriting, card brand rules, and applicable laws apply.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
