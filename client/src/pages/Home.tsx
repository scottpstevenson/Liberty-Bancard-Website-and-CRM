import { SEO, getLocalBusinessSchema, getWebSiteSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeSolutions } from "@/components/home/HomeSolutions";
import { HomeFounder } from "@/components/home/HomeFounder";
import { HomeReview } from "@/components/home/HomeReview";
import { HomeStartingPoints } from "@/components/home/HomeStartingPoints";
import { HomeIndustries } from "@/components/home/HomeIndustries";
import { HomeHowItWorks } from "@/components/home/HomeHowItWorks";
import { HomePrograms } from "@/components/home/HomePrograms";
import { HomeProof } from "@/components/home/HomeProof";
import { HomeFaq } from "@/components/home/HomeFaq";
import { HomeFinal } from "@/components/home/HomeFinal";

/**
 * Public Home: evergreen hero, solution starting points (#solutions), founder note, businesses we
 * serve, contextual starting points, what the review gives you, how it works, program options
 * (#processing-options), merchant proof, common questions, final action. Hero, solutions, founder
 * and starting-point copy is shared with the server-rendered Home (shared/public-home-content.ts).
 * The rate calculator lives at /estimate and is linked from the FAQ.
 */
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO ogImage="https://libertybancard.com/og-home-logo-card.jpg" title="Merchant Payment Processing | Liberty Bancard" description="Liberty Bancard — credit card processing and merchant services for South Florida businesses. Transparent rates, free statement review, no hidden fees." path="/" keywords="payment processing, merchant services, credit card processing, statement review, interchange plus pricing, wholesale rates" structuredData={[getLocalBusinessSchema(), getWebSiteSchema()]} />
      <Navbar />

      <main className="marketing-surface flex-grow pt-[var(--public-header-height)] md:pt-24 dock-clearance-main md:pb-0">
        <HomeHero />
        <HomeSolutions />
        <HomeFounder />
        <HomeIndustries />
        <HomeStartingPoints />
        <HomeReview />
        <HomeHowItWorks />
        <HomePrograms />
        <HomeProof />
        <HomeFaq />
        <HomeFinal />
      </main>

      <Footer />
    </div>
  );
}
