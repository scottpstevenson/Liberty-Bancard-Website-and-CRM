import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { PublicSection } from "@/components/public/PublicSection";
import { INDUSTRIES_HUB, industryHref, PUBLIC_INDUSTRIES } from "@shared/public-industries";

/**
 * Industries hub: every existing /industries/:slug page in one list. It is navigation only, so it
 * carries no pricing, savings or eligibility statement. Copy lives in shared/public-industries.ts and
 * is shared with the server-rendered hub (server/ssr/industries-hub.ts).
 */
export default function Industries() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={INDUSTRIES_HUB.title}
        description={INDUSTRIES_HUB.description}
        path={INDUSTRIES_HUB.path}
        keywords={INDUSTRIES_HUB.keywords}
        breadcrumbs={[{ name: "Industries", path: INDUSTRIES_HUB.path }]}
      />
      <Navbar />
      <main className="marketing-surface flex-grow pt-[var(--public-header-height)] md:pt-24 dock-clearance-main md:pb-0">
        <PublicSection tone="light" labelledBy="industries-hub-heading" data-testid="section-industries-hub">
          <div className="mb-8 max-w-3xl">
            <h1 id="industries-hub-heading" className="public-h1 text-foreground" data-testid="text-industries-title">
              {INDUSTRIES_HUB.heading}
            </h1>
            <p className="public-body public-secondary mt-3 lg:text-lg" data-testid="text-industries-intro">{INDUSTRIES_HUB.intro}</p>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="grid-industries">
            {PUBLIC_INDUSTRIES.map((industry) => (
              <li key={industry.slug}>
                <Link
                  href={industryHref(industry.slug)}
                  className="group public-card public-card--brand flex h-full flex-col p-5"
                  data-testid={`card-industry-${industry.slug}`}
                >
                  <h2 className="public-h3 text-foreground">{industry.label}</h2>
                  <p className="public-body public-secondary mt-1 flex-1">{industry.summary}</p>
                  <span className="public-tap mt-3 inline-flex items-center gap-1.5 font-semibold text-primary underline underline-offset-4 group-hover:no-underline">
                    View {industry.label.toLowerCase()} page
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </PublicSection>
      </main>
      <Footer />
    </div>
  );
}
