import { SEO, getLocalBusinessSchema, getWebSiteSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeReview } from "@/components/home/HomeReview";
import { HomeIndustries } from "@/components/home/HomeIndustries";
import { HomeHowItWorks } from "@/components/home/HomeHowItWorks";
import { HomePrograms } from "@/components/home/HomePrograms";
import { HomeProof } from "@/components/home/HomeProof";
import { HomeFaq } from "@/components/home/HomeFaq";
import { HomeFinal } from "@/components/home/HomeFinal";

/**
 * Public Home, eight sections in the order set by the mobile audit: merchant-first hero, what the
 * review gives you, businesses we serve, how it works, program options, merchant proof, common
 * questions, final action. The rate calculator lives at /estimate and is linked from the FAQ.
 */
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Merchant Payment Processing | Liberty Bancard" description="Liberty Bancard — credit card processing and merchant services for South Florida businesses. Transparent rates, free statement review, no hidden fees." path="/" keywords="payment processing, merchant services, credit card processing, statement review, interchange plus pricing, wholesale rates" structuredData={[getLocalBusinessSchema(), getWebSiteSchema()]} />
      <Navbar />

      <main className="marketing-surface flex-grow pt-[var(--public-header-height)] md:pt-24 dock-clearance-main md:pb-0">
        <HomeHero />
        <HomeReview />
        <HomeIndustries />
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
