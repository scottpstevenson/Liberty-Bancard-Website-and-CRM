import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { OverviewPageView } from "@/components/public/OverviewPageView";
import { PRICING_AND_PROGRAMS_PAGE } from "@shared/public-overview-pages";

/** Overview page; copy lives in shared/public-overview-pages.ts and is shared with the server renderer. */
export default function PricingPrograms() {
  const page = PRICING_AND_PROGRAMS_PAGE;
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={page.shortTitle}
        description={page.description}
        path={page.path}
        keywords={page.keywords}
        breadcrumbs={[{ name: page.breadcrumbLabel, path: page.path }]}
      />
      <Navbar />
      <main className="marketing-surface flex-grow pt-[var(--public-header-height)] md:pt-24 dock-clearance-main md:pb-0">
        <OverviewPageView page={page} />
      </main>
      <Footer />
    </div>
  );
}
