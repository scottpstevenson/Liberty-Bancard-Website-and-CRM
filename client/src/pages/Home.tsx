import { SEO, getWebSiteSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeSolutions } from "@/components/home/HomeSolutions";
import { HomeIndustries } from "@/components/home/HomeIndustries";
import { HomeStartingPoints } from "@/components/home/HomeStartingPoints";
import { HomeFounder } from "@/components/home/HomeFounder";
import { HomeProcess } from "@/components/home/HomeProcess";
import { HomeFaq } from "@/components/home/HomeFaq";
import { HomeFinal } from "@/components/home/HomeFinal";
import { HOME_LOCAL_BUSINESS_SCHEMA, HOME_META, HOME_ORGANIZATION_SCHEMA } from "@shared/public-home-content";

/**
 * Public Home. Section order (also the order of the server-rendered Home, which tags each section with
 * the same data-home-section value): hero, three service choices (#solutions), industries, contextual
 * starting points, founder note, process worksheet, common questions, final contact. Copy lives in
 * shared/public-home-content.ts. Programs, pricing structure and comparisons are on
 * /pricing-and-programs; the rate calculator is /estimate.
 */
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        ogImage={HOME_META.ogImage}
        title={HOME_META.shortTitle}
        description={HOME_META.description}
        path="/"
        keywords={HOME_META.keywords}
        structuredData={[HOME_ORGANIZATION_SCHEMA, HOME_LOCAL_BUSINESS_SCHEMA, getWebSiteSchema()]}
      />
      <Navbar />

      <main className="marketing-surface flex-grow pt-[var(--public-header-height)] md:pt-24 dock-clearance-main md:pb-0">
        <HomeHero />
        <HomeSolutions />
        <HomeIndustries />
        <HomeStartingPoints />
        <HomeFounder />
        <HomeProcess />
        <HomeFaq />
        <HomeFinal />
      </main>

      <Footer />
    </div>
  );
}
